# DTS-CONTROLS — Effect controls from the DTS design guide, generalised for Canteiro

> Analyst: dts-controls (read-only). Source analysed: `/root/.claude/uploads/d1659d46-7fc1-552e-ba5d-02ae16117f1f/f3d07c2a-DTS_-_Guia_de_Design_para_apresenta__es.html` (880 KB, 40 effects, `window.DTS` runtime).
> Target: Canteiro (`scratchpad/studio`: `runtime.js` = `window.AMRT`, `runtime.css`, `editor.js`, `editor.html`, `assemble.py` → `AM-Studio-Editor.html`).
> Screenshots: `/tmp/claude-0/-home-user-videosflows/d1659d46-7fc1-552e-ba5d-02ae16117f1f/scratchpad/qa-understand/dts-controls/` (abbreviated below as `SHOTS/`).
> Scratch scripts in the same folder (`dump.js`, `labels.js`, `verify.js`, `waapi.js`, `seek.js`, `conflict.js`) reproduce every measurement in this doc.

---

## 0. TL;DR: decisions for builders

1. **The guide has 40 effects, and each demo has its own control bar.** The ten words the user cited ("camadas, profundidade, repouso, pausar, avançar, reiniciar efeito, velocidade, tour automático, Glow, varrer agora") appear verbatim (as labels or button text) in 17 of those demos: 01 02 03 04 05 06 08 09 13 17 18 19 26 32 33 38 39. Each one maps to one of **five implementation techniques** (§3.11). All five can be generalised without rewriting Canteiro's CSS.
2. **Presenter dock (player, P0).** Add it to `AMRT.player` in `runtime.js`. The editor's "Apresentar" mode and every exported `.html` then get it for free. The engine has three parts (all proven in Chromium, see §6.3):
   - **Pause/resume** uses one class on the stage: `.am-paused *{animation-play-state:paused!important}`. This is the same trick the guide uses for its catalogue minis.
   - **Speed 0.25×–2×** uses the Web Animations API: `stage.getAnimations({subtree:true}).forEach(a=>a.playbackRate=k)`. It covers every existing CSS animation (entrances, component internals, loops) without touching a single CSS rule. Measured: `rate 0.25` → 400 ms of real time advanced 100 ms of animation time.
   - **Step (Passo)** seeks paused animations: `a.currentTime += 500`. Measured: works and holds while paused, and backward seeking works too.
   - The JS-driven parts (`runFx` counters/cycles) move to a **pausable slide clock** (`mkClock()`, dt × rate). This is the guide's effect-01 timeline model.
3. **Per-element settings (editor, P0).** Extend `el.anim` with `spd` (Velocidade), `rep` (Repetir), `step` (Ordem/Avançar), `emph` + `emphAt` (Ênfase), `rest`/`lift` (Repouso/Destaque elevation 0–3), `glow`/`gcol` (camada Glow), `sweep` (camada Varredura) and `depth` (camada Profundidade).
   - `safeEl()` whitelists `anim` keys. It **must** be extended, or the new keys are dropped on open/import (§5.1).
4. **Fix an existing bug while doing it (P0).** In the presentation, any element with an *Efeito contínuo* (Pulsar/Flutuar) **ignores its hover effect**. Both use `transform` on `.am-fxw`. Proven: `loop=float` plus `hover=zoom` gives `matrix(1,0,0,1,0,-8.9)` on hover, with no scale.
   - Fix: rewrite `amPulse`/`amFloat` with the individual `scale`/`translate` properties.
   - Also move the hover/depth transform to a new wrapper `.am-hv` (§5.2).
5. **Mapping (§7).** Of the 40 guide effects:
   - 13 supply the control vocabulary, which becomes dock, runtime and layer features: 01 02 03 04 05 06 08 17 19 26 32 38 40.
   - As visuals, they yield 8 new entrances, 5 emphasis effects, 5 loops, 6 hover/click effects, 3 slide transitions, 4 live backgrounds and 11 new components.
   - 9 upgrade existing Canteiro components: 03 07 12 13 15 16 19 35 38.
   - 3 are not ported as visuals: 26, 27 and 34. A fourth, 31, is already covered by "Reflexo" plus Varredura.
   - Canteiro goes from **70 distinct effect choices today to 139** (§8).
6. **Brand.** The guide uses DTS orange `#F26B21`/`#FF8A4C`/`#D9521A` and Inter. Canteiro must map everything to A&M: one orange `#F78C16`, navy `#002A46`, steel `#43698F`/`#7EA1C3`, never red (§9).

---

## 1. How the guide is built (useful facts)

- Effects register with `DTS.register({num,id,name,category,filters,intents,intensity,interaction,summary,what,communicates,where,dts,avoid,tags,mini:{html,css},demo:{html,css,init(root,api)}})`. There is one `<script>` per effect, starting at line 839 of the HTML.
- `init(root, api)` gets a **managed API** (`makeApi`). Every `raf`, `timeout`, `interval`, `on` and `observe` call is tracked, and `api.cleanup()` cancels all of them. Replay = `unmountDemo(); mountDemo(e)` (button "Replay", key **R**).
  ```js
  raf(fn) { let id=0,last=performance.now(),running=true;
    const loop=(t)=>{ if(!running||disposed) return; const dt=Math.min(64,t-last); last=t; fn(t,dt); id=requestAnimationFrame(loop); ... }; ... }
  tween(o) { /* {duration, delay, ease, from, to, onUpdate(v,e,p), onComplete} built on raf */ }
  stagger(els, fn, step=90, base=0)
  ```
  `dt` is clamped to 64 ms. Every "speed" control in the guide does `t += dt * speed`, so a background tab can never jump.
- Catalogue cards ("box" mode) contain a **mini** (CSS-only loop, 132 px tall). Minis pause off-screen:
  ```css
  .mini:not(.is-visible) *{animation-play-state:paused!important}
  ```
  An `IntersectionObserver` with `rootMargin:'80px 0px'` toggles `.is-visible`. SHOTS/00-catalog.png
- The effect page shows a big live stage, which uses `container-type:size` and `@container` rules that hide labels and readouts below 600 px. Next to it:
  - a **dose of motion** badge (`intensity` 1 Sutil · 2 Moderada · 3 Intensa; rule: "no máximo um efeito intenso por capítulo, e nunca sobre dados");
  - "O que é", "Onde utilizar", "Quando evitar" and related panels.

  SHOTS/01-effect-page-06.png. At 390 px wide, the guide's own stage overflows (SHOTS/02-mobile-fx01.png): **do not copy its stage sizing** for the dock.
- The 9 communication intents ("O que quero comunicar?") are: foco, magnitude, tempo, processo, comparacao, relacao, detalhe, abertura, ritmo. Each effect has 1–2 of them, and they make good filter chips for a Canteiro gallery.

---

## 2. Inventory: all 40 effects

Dose: 1 = Sutil, 2 = Moderada, 3 = Intensa. "Controls" is the exact text of each demo's control bar, with group labels in CAPS. "Readout" is the live value pill in the top-right corner of the stage.

| # | id | Name | Category (+filters) | Dose | One-line description | Demo controls (exact UI) | Readout |
|---|---|---|---|---|---|---|---|
| 01 | motion-graphics | Motion Graphics | Motion (+Storytelling) | 3 | Chapter opener: ring draws, square lands, title word by word, stats count up, on one 3 s timeline. | `❚❚ Pausar` `↻ Reiniciar` · VELOCIDADE `0,5×` `1×` `2×` · `Loop` · 4 phase buttons `01·Formas` `02·Linhas` `03·Título` `04·Dados` (click = seek) · status | `t 0,00 s / 3,00 s` |
| 02 | icon-motion | Icon Motion | Motion (+UX/UI) | 1 | Line icons draw their stroke on entry; each has its own hover micro-motion (lift, pulse, spin, layers, gear, shield check). | `↻ Redesenhar` `Tour automático` · TRAÇO `Rápido`(500) `Normal`(900) `Lento`(1600) | `hover — <name> <motion>` |
| 03 | hologram-3d-cards | Hologram 3D Cards | 3D (+Interatividade) | 2 | Card with perspective tilt, cursor glare, edge glow, holographic sweep and translateZ depth. | CAMADAS DO EFEITO `Tilt 3D` `Glow` `Sweep holográfico` `Profundidade` (4 independent toggles, all on) | `rotateX 0.0° rotateY 0.0°` |
| 04 | 3d-tilt-perspective | 3D Tilt / Perspective | 3D (+Interatividade) | 2 | 4-layer architecture stack (preserve-3d) that tilts with the cursor; click a layer to focus it. | PROFUNDIDADE `Compacta`(28) `Normal`(46) `Explodida`(80) · `Perspectiva` `Órbita` · `↻ Reset` | `rotateX 56° rotateY 0°` |
| 05 | hover-elevation | Hover Elevation | UX/UI (+Interatividade) | 1 | Elevation system 0–3 (shadow + y-offset); cards rise from rest level to hover level in 220 ms. | REPOUSO `0` `1` · HOVER `1` `2` `3` · `Demonstrar` | `elevação nível 1 · 0 1px 2px · y −1px` |
| 06 | glow-light-sweep | Glow / Light Sweep | Motion (+UX/UI) | 2 | Hero KPI with pulsing glow ring and periodic diagonal light sweep; secondary KPIs stay quiet. | `Glow` `Sweep` · INTERVALO `3 s` `5 s` `8 s` · COR `Laranja` `Steel` · `✦ Varrer agora` | `próximo sweep 3,0 s · glow ×1,0` |
| 07 | glassmorphism | Glassmorphism | UX/UI (+3D) | 1 | Draggable frosted-glass panel over content; blur adjustable. | BLUR range 16 px · `Borda` `Brilho` · `Centralizar` | `backdrop-filter blur(16px) saturate(140%)` |
| 08 | animated-gradient | Animated Gradient | Motion (+Storytelling) | 2 | Cover with navy/steel/orange gradient orbs drifting on a 24 s cycle. | `❚❚ Pausar` · VELOCIDADE `Lento`(0.5) `Médio`(1) `Rápido`(2.2) · TÉCNICA `Orbes` `Posição` | `ciclo 24 s` |
| 09 | parallax | Parallax | 3D (+Storytelling, Motion) | 2 | 4 scene layers move at different speeds with the cursor; idle drift; exploded layer view. | PROFUNDIDADE `Sutil`(0.5) `Normal`(1) `Forte`(1.8) · `Ver camadas` | `dx 0% dy 0%` |
| 10 | reveal-mask-reveal | Reveal / Mask Reveal | Motion (+Storytelling) | 2 | Blocks revealed from a clip-path mask (curtain, iris, diagonal), staggered. | MÁSCARA `Cortina` `Íris` `Diagonal` · STAGGER `80 ms` `140 ms` `240 ms` · `↻ Revelar` | `clip-path inset(0 100% 0 0)` |
| 11 | animated-typography | Animated Typography | Motion (+Storytelling) | 2 | Headline enters by word/letter/line; orange highlight underlines; number lands. | UNIDADE `Por palavra` `Por letra` `Por linha` · `↻ Reproduzir` | `unidades 41 stagger 70 ms` |
| 12 | counter-animation | Counter Animation | Data Viz (+Motion) | 1 | KPI numbers count from 0 with selectable easing. | EASING `Linear` `Out Cubic` `Out Expo` · DURAÇÃO `0,6 s` `1,2 s` `2,0 s` · `↻ Recontar` | (none) |
| 13 | progress-motion | Progress Motion | Data Viz (+Motion) | 1 | Maturity bars and ring fill to the real score, with target marker. | `↻ Reanimar` · CAMADAS `Meta` `Ciclo anterior` | (none) |
| 14 | heatmap-animation | Heatmap Animation | Data Viz (+Motion) | 2 | Heat matrix cells enter cold→hot; hover value; animated re-sort. | `↻ Reanimar` `Ordenar por intensidade` `Valores` · legend 0–100 | `Passe o cursor sobre uma célula` |
| 15 | data-highlight | Data Highlight | Data Viz (+UX/UI) | 1 | Insight buttons dim the chart and light only the supporting bars in orange. | INSIGHTS `1·Concentração` `2·Abaixo da meta` `3·Maior salto` · `Visão geral` | (none) |
| 16 | chart-build-animation | Chart Build Animation | Data Viz (+Motion) | 2 | Chart builds in stages (bars, line, points, axes); scrubbable timeline. | `▶ Construir` · ORDEM `Por série` `Por eixo X` · LINHA DO TEMPO range (scrub) | `Fase 1 · barras 4%` |
| 17 | bpmn-flow-motion | BPMN Flow Motion | Processos (+Motion) | 2 | Token travels the BPMN diagram, lighting tasks, gateway and lanes in execution order. | `❚❚ Pausar` `Passo ›` · VELOCIDADE `0,6×` `1×` `1,8×` · status | (status pill) |
| 18 | connector-flow-line | Connector / Flow Line | Processos (+Motion) | 2 | Connectors draw between architecture nodes, then flow (marching dashes / packets). | `↻ Redesenhar` · CAMADAS `Fluxo contínuo` `Pacotes` | `Passe o cursor sobre um nó…` |
| 19 | pulse-beacon | Pulse / Beacon | UX/UI (+Motion) | 1 | Expanding rings mark attention points on a stakeholder map; notes open in a tour. | ANÉIS `2` `3` · RITMO `Calmo`(3.2 s) `Normal`(2.2 s) · `Tour automático` · `Próximo ponto ›` | `2 pontos de atenção · 6 stakeholders` |
| 20 | ripple-interaction | Ripple Interaction | Interatividade (+UX/UI) | 1 | Circular wave from the click point confirms the touch. | DURAÇÃO `0,3 s` `0,5 s` `0,8 s` · ORIGEM `Clique` `Centro` · `Laranja` · `Simular clique` | `último ripple —` |
| 21 | flip-card | Flip Card | Interatividade (+3D) | 2 | Cards flip in 3D on click: AS-IS front, TO-BE back. | DURAÇÃO `0,45 s` `0,7 s` `1,0 s` · EIXO `Horizontal` `Vertical` · `Virar todos ↻` | `1 de 3 no TO-BE` |
| 22 | expandable-card | Expandable Card | Interatividade (+UX/UI) | 1 | Collapsed cards expand (animated height), one at a time. | DURAÇÃO `0,25 s` `0,45 s` `0,7 s` · `Recolher` · `Próxima iniciativa ›` | `0 de 4 aberta` |
| 23 | modal-focus | Modal Focus | UX/UI (+Interatividade) | 1 | KPI card takes the stage: dimmed, blurred backdrop and scaled panel. | ENTRADA `Escala` `Subida` · `Blur no fundo` · `Abrir destaque` | `fechado` |
| 24 | spotlight-focus | Spotlight / Focus | Storytelling (+UX/UI) | 2 | Light spot dims the rest of the diagram, step by step or following the cursor. | NARRATIVA `Passo 1` `Passo 2` `Passo 3` · `Livre · cursor` · `Sem foco` | `x 50% y 28% PASSO 1/3` |
| 25 | magnetic-button | Magnetic Button | Interatividade (+Motion) | 2 | CTA pulled by the cursor inside a radius, spring back with ~150 ms overshoot. | RAIO `100 px` `130 px` `160 px` · FORÇA `Suave` `Média` `Forte` · `Mostrar raio` | `dist — offset 0·0 REPOUSO` |
| 26 | microinteractions | Microinteractions | UX/UI (+Interatividade) | 1 | Toggle, check, chips, save: 150–300 ms feedback; a `--k` var slows all of them. | VELOCIDADE `1× real` `Câmera lenta 4×` · `↻ Reiniciar estado` | `feedback —` |
| 27 | scroll-reveal | Scroll Reveal | Motion (+Storytelling) | 1 | Diagnosis blocks enter as the inner list scrolls. | ENTRADA `Subir` `Da esquerda` `Escala` · `Repetir ao sair` · `▶ Rolar automaticamente` | `revelados 3/6` |
| 28 | sticky-storytelling | Sticky Storytelling | Storytelling (+Motion) | 2 | Visual stays fixed (left) and changes phase while text steps scroll (right). | IR PARA `Fase 1`…`Fase 4` · `▶ Narrar` | `fase 1/4 scroll 0%` |
| 29 | morphing-shapes | Morphing Shapes | Motion (+Storytelling) | 2 | SVG point interpolation: silos → hub → mesh. | ESTADO `AS-IS·Silos` `TO-BE·Hub` `TO-BE·Mesh` · `❚❚ Auto` | `morph 100% destino Silos` |
| 30 | particle-system | Particle System | 3D (+Motion, Storytelling) | 3 | Canvas particle field linked by proximity, reacts to the cursor. | DENSIDADE `Baixa` `Média` `Alta` · CURSOR `Repelir` `Atrair` · `◎ Pulso` | `partículas 90 conexões 0 fps 60` |
| 31 | shimmer-holographic-sweep | Shimmer / Holographic Sweep | Motion (+UX/UI) | 1 | Shimmer over a skeleton until data loads, plus a holographic seal. | `Carregar dados` · SWEEP DO SELO `Periódico` `Só no hover` | `dados carregando…` |
| 32 | floating-elements | Floating Elements | Motion (+3D) | 2 | 8 capability cards orbit a core with individual periods; focus ramps the card to a stop in 300 ms. | AMPLITUDE `Sutil` `Média` `Ampla` · `Conexões` · `Tour automático` | `em foco <name> amplitude 1,0×` |
| 33 | card-stack | Card Stack | Interatividade (+3D, Storytelling) | 2 | Stacked phase cards; top card dragged/clicked to the back. | `‹ Anterior` `Próximo ›` · `↻ Reiniciar` | `etapa 01 / 05` |
| 34 | carousel-horizontal-gallery | Carousel / Horizontal Gallery | Interatividade (+UX/UI) | 1 | Scroll-snap service gallery. | `‹` `›` · 6 dots · SCROLL-SNAP `Ligado` | `card 02 / 06` |
| 35 | interactive-matrix | Interactive Matrix | Interatividade (+Data Viz) | 1 | Impact × effort matrix with draggable bubbles and live legend. | `↺ Reposicionar` · BOLHA `Tamanho = valor` · `Limpar destaque` | `impacto — esforço —` |
| 36 | tooltip-contextual-info | Tooltip / Contextual Info | UX/UI (+Interatividade) | 1 | Auto-positioned tooltips (owner, status, detail) per component. | `▶ Tour pelos componentes` · POSIÇÃO `Auto` `Acima` `Abaixo` | `posição — x, y —` |
| 37 | before-after-slider | Before / After Slider | Interatividade (+Storytelling) | 1 | Draggable divider compares AS-IS vs TO-BE dashboards. | `▶ Animar comparação` · POSIÇÃO `AS-IS` `50/50` `TO-BE` (+ ← → keys) | `divisor 100%` |
| 38 | timeline-motion | Timeline Motion | Storytelling (+Motion, Processos) | 2 | Roadmap line draws wave by wave; each milestone opens its detail card. | `‹ Anterior` `Próximo ›` · AUTOPLAY `▶ Ligado` · `↻ Reiniciar` | `onda 01/04 roadmap 25%` |
| 39 | node-network-motion | Node Network Motion | Processos (+Data Viz, 3D) | 2 | Living network; touching a node lights neighbours and dims the rest. | CAMADAS `Flutuação` `Rótulos` · `⟳ Reorganizar` | `nó — conexões –` |
| 40 | animated-shader-hero | Animated Shader / Hero | 3D (+Motion, Storytelling) | 3 | WebGL noise waves in navy with an orange wire behind the title (2D fallback). | INTENSIDADE `Sutil` `Moderada` `Intensa` · `Fio laranja` · `❚❚ Congelar` | `render WebGL fps —` |

Counts by category: Motion 11, UX/UI 7, 3D 6, Interatividade 7, Data Viz 5, Processos 2, Storytelling 2 (primary category). Filter tags overlap: Motion 23, UX/UI 14, Interatividade 14, Storytelling 14, 3D 10, Data Viz 7, Processos 4.

---

## 3. The control vocabulary in depth

Matrix: which demos expose which concept. "≈" means the same concept under another label.

| Concept (user's word) | Effects that have it | Label(s) in the guide |
|---|---|---|
| **Camadas** (layers) | 03, 13, 18, 39 (+09 "Ver camadas", 04 legend) | "CAMADAS DO EFEITO", "CAMADAS", "Ver camadas" |
| **Profundidade** (depth) | 04, 09, 03 (layer) | "PROFUNDIDADE" Compacta/Normal/Explodida · Sutil/Normal/Forte · toggle "Profundidade" |
| **Repouso** (rest) | 05 (+25 readout "REPOUSO") | "REPOUSO 0 1" |
| **Pausar** | 01, 08, 17 (≈ 29 "❚❚ Auto", 38 "❚❚ Pausado", 40 "❚❚ Congelar") | "❚❚ Pausar" ↔ "▶ Reproduzir"/"▶ Retomar"/"▶ Play" |
| **Avançar** (step/next) | 17 "Passo ›", 19 "Próximo ponto ›", 22 "Próxima iniciativa ›", 33/38 "Próximo ›", 01 phase seek, 24 "Passo 1·2·3", 28 "Fase 1–4" | various |
| **Reiniciar efeito** | global "Replay" + **R**; 01/33/38 "↻ Reiniciar"; 02/18 "↻ Redesenhar"; 13/14 "↻ Reanimar"; 12 "↻ Recontar"; 10 "↻ Revelar"; 11 "↻ Reproduzir"; 26 "↻ Reiniciar estado"; 04 "↻ Reset" | |
| **Velocidade** | 01 (0,5/1/2×), 08 (Lento/Médio/Rápido), 17 (0,6/1/1,8×), 26 (1×/4× slow-mo); per-parameter durations in 02, 12, 20, 21, 22 | "VELOCIDADE", "TRAÇO", "DURAÇÃO" |
| **Tour automático** | 02, 19, 32 (+36 "▶ Tour pelos componentes", 38 AUTOPLAY, 28 "▶ Narrar", 27 "▶ Rolar automaticamente", 05 "Demonstrar", 29 "Auto") | "Tour automático" toggle |
| **Glow** | 03 (layer), 06 (toggle + colour) | "Glow" |
| **Varrer agora** | 06 (+31 "Carregar dados" anticipates sweep, 03 periodic sweep layer) | "✦ Varrer agora" (orange primary button) |

### 3.1 Camadas: independent layer toggles
**UI (03).** A mono caps label "CAMADAS DO EFEITO" followed by 4 toggle buttons, all initially `.is-on` (navy fill, white text; off = white with grey border). Each toggles one visual layer **without restarting** the effect. SHOTS/fx-03.png, SHOTS/fx-03-hover-all-layers.png.

**Technique.** A boolean map is applied as classes or styles on the element. CSS hides a layer with `:not(.layer-on)`.
```js
const layers = { tilt: true, glow: true, sweep: true, depth: true };
const applyLayers = () => {
  card.classList.toggle('glow-on', layers.glow);
  card.classList.toggle('sweep-on', layers.sweep && !api.reduced);
  depthEls.forEach(el => { el.style.transform = layers.depth ? `translateZ(${el.dataset.depth}px)` : 'translateZ(0)'; }); // title 40, meta 24, foot 16
  if (!layers.tilt) card.style.transform = '';
};
btn.onclick = () => { layers[btn.dataset.layer] = !layers[btn.dataset.layer]; btn.classList.toggle('is-on', layers[btn.dataset.layer]); applyLayers(); };
```
```css
.card:not(.glow-on) .glare{display:none}
.card:not(.sweep-on) .sweep{display:none}
.card.is-hover.glow-on{box-shadow:0 30px 60px rgba(11,37,69,.35),0 0 0 1px rgba(255,255,255,.12) inset,0 0 40px rgba(110,143,191,.45),0 0 90px rgba(242,107,33,.18)}
.sweep{position:absolute;inset:-50%;background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.10) 46%,rgba(163,184,214,.42) 50%,rgba(255,138,76,.30) 54%,transparent 60%);mix-blend-mode:screen;animation:sweep 4.6s cubic-bezier(.65,0,.35,1) infinite}
@keyframes sweep{0%,55%{transform:translateX(-70%)}100%{transform:translateX(70%)}}
```
The same pattern appears elsewhere:
- 13: `Meta` and `Ciclo anterior` overlays;
- 18: `is-flow` class drives marching dashes (`stroke-dasharray` animation 1.1 s, 0.55 s on hot edge), plus a `Pacotes` toggle;
- 39: `no-labels` class, `Flutuação` toggle.

**Generalisation.** Use "Camadas do efeito" both as a per-element panel block (Glow · Varredura · Profundidade · Elevação) and as a deck-wide dock popover (Glow · Varredura · Profundidade · Contínuos).

### 3.2 Profundidade: depth amount and perspective
**04 UI.** PROFUNDIDADE `Compacta` 28 px · `Normal` 46 px (default) · `Explodida` 80 px. Next to it are `Perspectiva` (on), `Órbita` (on) and `↻ Reset`. SHOTS/fx-04.png, SHOTS/fx-04-explodida-foco.png.

**Technique.** A CSS var per layer, with a lerped tilt in rAF:
```js
const applyGap = () => { stack.style.setProperty('--gap', gap+'px'); layers.forEach(l => l.style.setProperty('--z', (l.dataset.layer*gap)+'px')); };
// layer CSS: transform:translateZ(var(--z,0)); transition:transform .55s cubic-bezier(.22,.61,.36,1)
// pillars: height:var(--gap) → distance between planes is visible
api.raf(t => {
  if (!hover && orbit) target = { rx: 56 + Math.cos(t/3400)*4, ry: 0 + Math.sin(t/2600)*16 };  // idle orbit
  const k = api.reduced ? .35 : .11; cur.rx += (target.rx-cur.rx)*k; cur.ry += (target.ry-cur.ry)*k;
  stack.style.transform = `rotateX(${cur.rx}deg) rotateY(${cur.ry}deg) translateZ(${-1.5*gap}px)`;
});
// pointer: target = { rx: 56 + (0.5-py)*22, ry: (px-0.5)*44 }; Perspectiva off → scene.classList.add('is-flat') → perspective:none
```
- Focus: clicking a layer sets `.has-focus` on the stack. Other layers drop to `opacity:.42` and the focused layer lifts `translateZ(18px)` with an orange outline.
- 09 (Parallax) uses PROFUNDIDADE as an amplitude multiplier: `Sutil` 0.5, `Normal` 1, `Forte` 1.8. Each layer has a depth factor (L0 0.015, L1 0.04, L2 0.08, L3 0.13), and displacement = cursor × half-size × factor × amp.
  - After 1.2 s idle there is a drift: `x = sin(t·0.45)·0.35`, `y = cos(t·0.33)·0.28`.
  - A `tanh` soft clamp keeps content inside the stage.
  - `Ver camadas` tweens each layer's z to `(i−1.5)·90px` over 800 ms (inOutCubic), with an exploded rotateX(56°) rotateZ(−22°) view. SHOTS/fx-09.png, SHOTS/fx-09-camadas.png.
- 03's `Profundidade` is the translateZ of inner text (40/24/16 px) inside a `preserve-3d` card.

### 3.3 Repouso: resting elevation
**05 UI.** REPOUSO `0` `1`(default) · HOVER `1` `2`(default) `3` · `Demonstrar`. A swatch strip shows Nível 0 plano · 1 repouso · 2 hover · 3 destaque, with the active level in orange. SHOTS/fx-05.png, SHOTS/fx-05-demo.png.

**Technique.** Elevation tokens as CSS vars plus `data-level` on the card. Transition is 220 ms ease-out. A press drops the card to rest level (scale .985, 80 ms).
```css
.fx-hover-elevation{--e0:none;--e1:0 1px 2px rgba(11,37,69,.07),0 1px 1px rgba(11,37,69,.04);
  --e2:0 8px 20px rgba(11,37,69,.11),0 2px 4px rgba(11,37,69,.06);--e3:0 20px 44px rgba(11,37,69,.18),0 6px 12px rgba(11,37,69,.08)}
[data-level="0"]{box-shadow:var(--e0);transform:translateY(0)}
[data-level="1"]{box-shadow:var(--e1);transform:translateY(-1px)}
[data-level="2"]{box-shadow:var(--e2);transform:translateY(-4px);border-color:#C9D6E8}
[data-level="3"]{box-shadow:var(--e3);transform:translateY(-8px);border-color:#A3B8D6}
.card{transition:transform .22s cubic-bezier(.22,.61,.36,1),box-shadow .22s cubic-bezier(.22,.61,.36,1),border-color .22s}
.card.is-pressed{transform:translateY(0) scale(.985)!important;transition-duration:.08s}
```
- `Demonstrar` is a tour: `interval(step, 1000)` (1600 ms when reduced motion) cycles `hoverLv` across cards plus one "all at rest" beat.
- Verified: rest 0 + hover 3 gives levels `0,3,0,0`.
- 25 (Magnetic) uses "repouso" for the button's rest state. It returns there through a damped spring with ~150 ms overshoot.

### 3.4 Pausar / Retomar / Congelar
- **01 and 08** keep a JS clock that advances only while playing: `if (playing) phase += dt*speed/BASE` (08, `BASE = 24000` ms per cycle). The button text toggles between `❚❚ Pausar` and `▶ Retomar` / `▶ Reproduzir`.
- **01** without loop: when `t >= T` the sequence ends, the button becomes `▶ Reproduzir`, and clicking it restarts from 0.
- **17** pauses the token's dwell/travel state machine.
- **40** `❚❚ Congelar` stops the shader `time` but keeps rendering for pointer input.
- **Catalogue minis** pause with `animation-play-state:paused!important` (CSS-only).

Verified (01): paused at `1,05 s`, still `1,05 s` 800 ms later. SHOTS/fx-01-paused.png.

### 3.5 Avançar: step, next, seek
**17 `Passo ›`.** If the token is dwelling, set `playing=false`, start the next travel, and poll every 30 ms until `phase==='dwell'`, then pause again. The button reads `▶ Play`. Verified: `Demanda recebida → Solicitar iniciativa | btn=▶ Play`. SHOTS/fx-17.png.
```js
const script = [{node:'start',dwell:500,flow:0},{node:'t1',dwell:1100,flow:1},{node:'gw',dwell:900,flow:2},{node:'t2',dwell:1100,flow:4},{node:'t3',dwell:1100,flow:5},{node:'end',dwell:1400,flow:null}];
// raf: dwell → t += dt*speed until s.dwell; travel → dur = max(350, len*3.2); p.getPointAtLength(inOutCubic(k)*len)
```
- **01 phase buttons** seek: `t = phases[i].from; playing = true; render()`. This is possible because rendering is **idempotent**: every track is `{from,to,ease,fn}` and `render()` recomputes all tracks from `t` (§3.11-A).
- **19/22/33/38** "Próximo" buttons stop the tour and step manually (`setTour(false); next()`).
- **38**: `‹ Anterior`/`Próximo ›` are disabled at the ends (`.is-off` + `disabled`). Navigation tweens the line width between milestone positions `[10, 36.67, 63.33, 90]%` in `max(260, Δ/26.67*720)` ms.
- Guide advice (10, "Quando evitar"): when the presenter goes back and forth, re-revealing becomes a visual tic. **Canteiro implication:** going back should show the previous slide already built (§6.3.6).

### 3.6 Reiniciar efeito
- **Global:** `replay()` = `unmountDemo(); mountDemo(e)` (button `Replay`, key **R**). Every timer is cleaned up by the managed API.
- **01 `↻ Reiniciar`:** a navy overlay `.fade` goes to opacity 1 (transition .26 s). After **280 ms**, it resets `t=0`, re-renders and fades back in. A restart never shows a blank flash. Also `playing = true`.
- **38 `↻ Reiniciar`:** cancels the in-flight tween, retracts the line to 0 in 420 ms, then `goTo(0)` after 160 ms.
- **02 `↻ Redesenhar`:** re-measures `getTotalLength()` and re-tweens `stroke-dashoffset` with 110 ms stagger.
- **12/13/14 `↻ Recontar`/`↻ Reanimar`:** re-run the tweens.

### 3.7 Velocidade
- **Clock multiplier (01, 08, 17, 40):** `t += dt * speed`. Chips: `0,5×` `1×`(default) `2×` (01); `0,6×` `1×` `1,8×` (17); `Lento` 0.5 `Médio` 1 `Rápido` 2.2 (08). The readout shows the effective cycle, `BASE/speed`.
- **CSS duration multiplier (26):** every duration is written `calc(180ms*var(--k,1))`, and `Câmera lenta 4×` sets `--k:4` on the root (verified `--k` = 4). This works for CSS-driven feedback, but requires rewriting each rule.
- **Per-parameter durations (02, 12, 20, 21, 22):** "TRAÇO Rápido/Normal/Lento" = 500/900/1600 ms; "DURAÇÃO 0,6/1,2/2,0 s".
- Reduced motion: 01 `speed=3` (finishes fast); 08 `speed×0.35`; 17 `speed=1.6`.
- Guide advice (01): in compressed video calls use **0,5×**.

### 3.8 Tour automático
**Shared contract:** cycle a "focus/hover" state across items on a timer, **until the presenter takes over** (any pointerenter, focus or manual "Próximo" stops the tour).

| Effect | Interval | Default | What cycles | Stop condition |
|---|---|---|---|---|
| 02 | `api.interval(step, 1300)` | off | `.is-hover` on next icon card | `pointerenter`/`focus` on any card → `stopTour()` |
| 19 | `interval(next, 3800)`, first after 750 ms | **on** | opens the note of the next beacon | click on node, background click with a note open, `Próximo ponto ›` |
| 32 | `interval(..., 2800)` | **on** | active card: its clock ramps to 0 in exactly 300 ms (`o.s += clamp(dt/300)`), scale 1.1, label shown | hover overrides while hovered |
| 05 `Demonstrar` | 1000 ms (1600 reduced) | off | hover level across cards and one rest beat | pointerenter |
| 36 `▶ Tour pelos componentes` | sequential | off | tooltip on each component | user hover/tab |
| 38 AUTOPLAY | `DWELL = 2600` (3200 reduced) | **on** (`▶ Ligado` ↔ `❚❚ Pausado`) | next milestone; at the end → `restart()` | `‹`/`›` set `setAuto(false)` |

SHOTS/fx-02-tour.png, SHOTS/fx-19.png, SHOTS/fx-38.png. Verified (02): tour sequence `0,1,2,3`, one step per 1.3 s.

### 3.9 Glow
**06** (SHOTS/fx-06.png). The hero tile has a ring element behind it, and only the opacity animates (cheap):
```css
.ring{position:absolute;inset:0;border-radius:18px;
  box-shadow:0 0 0 2px rgba(var(--glow),.55),0 0 26px 8px rgba(var(--glow),.5),0 0 56px 14px rgba(var(--glow),.16);
  opacity:.6;animation:pulse 3s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:.5;transform:scale(.995)}50%{opacity:1;transform:scale(1.006)}}
/* hover: a SECOND layer (::after) with a 1.4 s pulse only gains opacity → the base pulse phase never jumps */
.ring::after{content:"";position:absolute;inset:0;border-radius:18px;opacity:0;transition:opacity .4s;animation:pulse-fast 1.4s ease-in-out infinite}
.is-hover .ring::after{opacity:1}              /* readout: glow ×1,0 → ×1,6 */
.no-glow .ring{opacity:0!important;animation:none}
.is-steel{--glow:110,143,191}                    /* COR Laranja | Steel; default --glow:242,107,33 */
```
- The secondary KPIs get **no** glow. The hierarchy comes from that absence ("contexto, não conclusão").
- 03: glow is a layer (glare `radial-gradient(360px circle at var(--mx) var(--my), …)` with `mix-blend-mode:screen`, plus an outer box-shadow on hover).

### 3.10 Varrer agora (sweep now)
**06** (SHOTS/fx-06-sweep-mid.png). It is a one-shot class-driven CSS animation, re-triggered by forcing a reflow. A periodic JS clock fires it every 3/5/8 s. `Varrer agora`, a hover or a click fires it immediately and **resets the countdown**.
```css
.sweep{position:absolute;inset:0;background-image:linear-gradient(115deg,transparent 38%,rgba(255,255,255,.10) 44%,rgba(255,255,255,.5) 50%,rgba(var(--glow),.42) 55%,transparent 62%);
  background-size:300% 100%;background-position:100% 0;background-repeat:no-repeat;mix-blend-mode:screen;opacity:0;pointer-events:none}
.hero.is-sweep .sweep{opacity:1;animation:run 1.1s cubic-bezier(.65,0,.35,1) forwards}
@keyframes run{from{background-position:100% 0}to{background-position:0% 0}}
```
```js
const sweep = () => { hero.classList.remove('is-sweep'); void sweepEl.offsetWidth; hero.classList.add('is-sweep'); };
api.on(sweepEl, 'animationend', () => hero.classList.remove('is-sweep'));
api.on(btnRun, 'click', () => { sweep(); next = interval; });
api.raf((t, dt) => { if (!sweepOn) return; next -= dt; if (next <= 0) { sweep(); next = interval; } nextOut.textContent = fmt(next); });
// first sweep at 1400 ms; reduced motion → sweepOn=false (sweep only on demand)
```
Verified: `.is-sweep` is present 450 ms after click and gone at 1.35 s. 31's "Carregar dados" plays the same role: it anticipates a scheduled sweep.

### 3.11 The five underlying techniques (what to reuse)
- **A. Idempotent timeline (01).** Tracks `{from,to,ease,fn}`, `render()` from `t`, and `t += dt*speed`. This gives pause, speed, seek (phase jump) and restart for free. It is best for JS-driven choreography.
- **B. Class-toggled CSS animation (06 sweep, 03 layers, 18 flow, 39 labels).** Restarting = remove class, `void el.offsetWidth`, add class, and `animationend` clears it.
- **C. CSS var multipliers (26 `--k`, 19 `--period`, 04 `--gap`/`--z`, 06 `--glow` rgb triplet).** These are live-tunable without restarting. 19's rings: `animation: ring var(--period) …` with `animation-delay: calc(var(--period)/3)` and `calc(var(--period)*2/3)`.
- **D. Lerped rAF follower (03, 04, 09, 32).** `cur += (target-cur)*k` with `k ≈ .08–.14`. Targets come from the pointer, from an idle orbit or drift, or from tour focus. Use a 300 ms linear ramp for stops (32).
- **E. Timer tours (02, 19, 32, 05, 38).** `interval` cycling a state class, stopped by user input.

Supporting patterns:
- readout pills (JetBrains Mono 10.5 px, `rgba(255,255,255,.85)` bg, 8 px radius);
- control bar (label `10px/.14em caps #8A97A8`; toggle `28px` tall, `8px` radius, `.is-on` = navy fill; primary action = orange `30px`);
- `@container` rules hiding labels below 600–720 px;
- reduced-motion branches in every `init` (`api.reduced`).

---

## 4. Canteiro today: baseline and constraints

- **DOM per element** (`runtime.js renderEl`):
  - `div.am-el[data-in][--d][--t]` (entrance animation, position %)
  - `> div.am-rot` (inline `rotate()`)
  - `> div.am-fxw[data-loop][data-hover]` (loop and hover, opacity, radius, content)
- **Animation model** `el.anim = {in, delay, dur, loop, hover}`:
  - entrance (8): `fade rise left right zoom focus wipe draw`;
  - loop (4): `pulse float glow shimmer`;
  - hover (4): `lift zoom glow tilt`;
  - slide transition `s.tr` (3): `fade slide zoom` (+`none`).

  Editor panel: SHOTS/c-anim-panel.png. Effects drawer: SHOTS/c-drawer-fx.png. Player: SHOTS/c-player.png.
- **Components:** 21 kinds in `AMRT.FX`. Twelve have variants (bars 2, timeline 3, process 3, raci 4, riskmap 4, swot 4, matrix 4, cardgrid 4, maturity 4, linechart 4, donut 3, gauge 3 = 42 variants). Nine have no variants. That makes **51 component animations**. Internal animations are hard-coded CSS, e.g. `.am-in .fxb-bar{animation:amGrow .9s … calc(var(--d,0ms) + var(--i)*110ms + 150ms) both}`.
- **JS effects** `runFx(st)`: counters use `performance.now()` with a fixed 1500 ms duration. Cycles use `setInterval(…,1400)` / `setInterval(…,2200)`. **None of these can be paused.**
- **Player** `AMRT.player(deck, root, opts)`:
  - bar: brand | `← Anterior` `01 / 0N` `Próximo →` | `Sair (Esc)` `⛶`;
  - keys: →/PageDown/Space/Enter, ←/PageUp/Backspace, Home/End, F, Esc;
  - click zones: right 18% → next, left 18% → previous;
  - `go(i)` replays entrances by toggling `am-pre`→`am-in`.
- **Exported HTML** embeds `runtime.css` + `runtime.js` and calls `AMRT.player(JSON…, el, {brand})`, so anything added to `player()` ships in every saved deck.
- **Constraints and bugs found:**
  1. **Loop and hover conflict (bug).** Both set `transform` on `.am-fxw`, and an animation beats a `:hover` declaration. Proven with `conflict.js`: `[{"loop":"float","transform":"matrix(1,0,0,1,0,-8.9)"},{"loop":"none","transform":"matrix(1.06,0,0,1.06,0,0)"}]`.
  2. **`safeEl()`** (editor.js ~l.149) rebuilds `anim` with `in` plus whitelisted `loop`, `hover`, `delay` and `dur`. **Unknown keys are dropped** on open, import and paste.
  3. **Glass component** (`.fxg`) uses `backdrop-filter`. Never put `filter`, `opacity<1`, `mask` or `clip-path` on any of its ancestors, or the blur stops sampling the slide. So **elevation and glow must use box-shadow on sibling layers, not `filter` on wrappers.**
  4. The player key handler ignores only `input|textarea|select`. Once the exported deck becomes editable (user item 9), it must also ignore `isContentEditable` targets.
  5. Reduced motion (runtime.css ~l.384) collapses all durations to .01 ms and kills `.am-fxw[data-loop]`. New layers must join that block.

---

## 5. (a) Per-element effect settings in the editor

### 5.1 Data model (backward compatible; every new key is optional)
```js
el.anim = {
  in: 'none', delay: 0, dur: 700,    // existing
  loop: 'none', hover: 'none',      // existing
  spd: 1,        // Velocidade: 0.5 | 0.75 | 1 | 1.5 | 2 (scales entrance, component internals, loop; NOT the start delay)
  rep: 0,        // Repetir (efeito contínuo): 0 = sempre | 1 | 3
  step: 0,       // Ordem: 0 = com o slide | 1..9 = no n-ésimo "Avançar"
  emph: 'none',  // Ênfase: 'none'|'sweep'|'beat'|'spot'|'raise'|'recount'
  emphAt: 0,     // 0 = logo após a entrada | 1..9 = no n-ésimo "Avançar"
  rest: 0,       // Repouso: elevação 0..3 (box types only)
  lift: 2,       // Destaque: elevação 1..3 ao passar o mouse/tour (only when hover==='lift')
  glow: 0,       // Camada Glow: 0 off | 1 fixo | 2 pulsante
  gcol: 'o',     // cor do glow: 'o' laranja #F78C16 | 's' steel #7EA1C3
  sweep: 0,      // Camada Varredura: 0 off | -1 na entrada | 3 | 5 | 8 (segundos)
  depth: 0       // Camada Profundidade: 0 plano | 1 sutil | 2 forte
};
```
**`safeEl` addition** (place right after the existing `['delay','dur']` line):
```js
function pick(v, list, def) { v = +v; return list.indexOf(v) >= 0 ? v : def; }
if (a.spd != null) o.anim.spd = pick(a.spd, [0.5, 0.75, 1, 1.5, 2], 1);
if (a.rep != null) o.anim.rep = pick(a.rep, [0, 1, 3], 0);
['step', 'emphAt'].forEach(function (k) { if (a[k] != null) o.anim[k] = Math.max(0, Math.min(9, a[k] | 0)); });
if (typeof a.emph === 'string' && /^(none|sweep|beat|spot|raise|recount)$/.test(a.emph)) o.anim.emph = a.emph;
if (a.rest != null) o.anim.rest = pick(a.rest, [0, 1, 2, 3], 0);
if (a.lift != null) o.anim.lift = pick(a.lift, [1, 2, 3], 2);
if (a.glow != null) o.anim.glow = pick(a.glow, [0, 1, 2], 0);
if (a.gcol === 's' || a.gcol === 'o') o.anim.gcol = a.gcol;
if (a.sweep != null) o.anim.sweep = pick(a.sweep, [0, -1, 3, 5, 8], 0);
if (a.depth != null) o.anim.depth = pick(a.depth, [0, 1, 2], 0);
```
Which element types get which block (enforced in UI and in `renderEl`):
- `BOX` = `type==='fx'` or `'image'`, or (`type==='shape'` and `shape` in `rect|round|pill`). **Camadas** (Glow, Varredura, Elevação) only appear for BOX.
- `kind==='glass'` hides Glow/Elevação (backdrop constraint; Varredura is allowed).
- Profundidade is allowed for every type except `line`.
- Text and line keep the existing loop "Brilho" as their glow.

### 5.2 DOM (renderEl)
New structure. `.am-hv` is **always** emitted; the other new nodes appear only when configured:
```
div.am-el [data-in] [data-spd] [data-step] [data-emph] [data-emph-at]   ← entrance (unchanged)
  div.am-rot                         ← inline rotate(); perspective when depth/tilt
    div.am-hv [data-hover] [data-lift] [data-rest] [data-depth]   ← NEW: hover + depth transform, :is(:hover,.am-hov)
      div.am-sh  (if rest>0 || hover==='lift' on BOX)  ← elevation box-shadow layer
      div.am-glow[data-g][data-c] (if glow>0 on BOX)    ← glow ring layer
      div.am-fxw [data-loop] [data-rep]                 ← loop + content (unchanged, minus data-hover)
      i.am-sweep [data-tone] [data-every] (if sweep≠0 or emph==='sweep', BOX)  ← sweep layer
```
```js
var a = el.anim || {}, spd = +a.spd || 1;
n.style.setProperty('--d', ((+a.delay || 0) * spd) + 'ms');  // pre-scaled: WAAPI rate=spd brings it back to the absolute delay (§6.3.2)
if (spd !== 1) n.dataset.spd = spd;
if (+a.step) n.dataset.step = a.step;
if (a.emph && a.emph !== 'none') { n.dataset.emph = a.emph; if (+a.emphAt) n.dataset.emphAt = a.emphAt; }
var hv = document.createElement('div'); hv.className = 'am-hv';
if (a.hover && a.hover !== 'none') { hv.dataset.hover = a.hover; if (a.hover === 'lift' && +a.lift !== 2) hv.dataset.lift = a.lift; }
if (+a.depth && el.type !== 'line') hv.dataset.depth = a.depth;
// fx.dataset.hover is NO LONGER set; loop stays on fx; repetition:
if (a.loop && a.loop !== 'none' && +a.rep) fx.dataset.rep = a.rep;
fx.innerHTML = content(el, w, h);
var R = radiusOf(el, fx, w, h);   // see below
if (isBox(el)) {
  if (+a.rest || a.hover === 'lift') { var sh = mk('div', 'am-sh'); sh.style.borderRadius = R; if (+a.rest) hv.dataset.rest = a.rest; hv.appendChild(sh); }
  if (+a.glow && el.kind !== 'glass') { var g = mk('div', 'am-glow'); g.dataset.g = a.glow; if (a.gcol === 's') g.dataset.c = 's'; g.style.borderRadius = R; hv.appendChild(g); }
}
hv.appendChild(fx);
if (isBox(el) && (+a.sweep || a.emph === 'sweep')) { var sw = mk('i', 'am-sweep'); sw.style.borderRadius = R; sw.dataset.tone = darkish(el) ? 'd' : 'l'; if (+a.sweep > 0) sw.dataset.every = a.sweep; if (+a.sweep === -1) sw.dataset.every = 'in'; hv.appendChild(sw); }
rot.appendChild(hv);
```
- `radiusOf`:
  - fx: read the inline `border-radius` of the first `.fx` child produced by `FX[kind].html` (every component sets it in `cqw`), else `CQ(el.radius)`;
  - image: `CQ(el.radius)`;
  - shape: `round` → `CQ(min(w,h)*.12)` or `el.radius`; `pill` → `999px`; `rect` → `CQ(el.radius)`.
- `darkish(el)`: true for `data.style==='dark'`, holo, fx-dark kinds, or shapes whose `fill` is navy (`#002A46`, `#0B3A63`, `#13315C`, `#001E32`).
- **`bindTilt` and CSS selectors** that used `.am-fxw[data-hover…]` move to `.am-hv[data-hover…]`. That is lines 43–50 of runtime.css and `runtime.js` l.426–427. The editor does not query these classes (grep-verified), so nothing else changes.

### 5.3 CSS (runtime.css)
```css
.am-rot,.am-hv,.am-fxw{position:relative;width:100%;height:100%}
/* Fix loop/hover conflict: loops animate individual properties, hover uses transform on .am-hv → they compose */
@keyframes amPulse{0%,100%{scale:1}50%{scale:1.045}}
@keyframes amFloat{0%,100%{translate:0 0}50%{translate:0 -1.1cqh}}
.am-fxw[data-loop][data-rep="1"]{animation-iteration-count:1}
.am-fxw[data-loop][data-rep="3"]{animation-iteration-count:3}

/* Elevation tokens (A&M navy 0,42,70; px→cqh at 720p: 1px=.139cqh) — two shadows each so transitions interpolate */
.am-stage{--am-e0:0 0 0 0 rgba(0,42,70,0),0 0 0 0 rgba(0,42,70,0);
  --am-e1:0 .14cqh .28cqh rgba(0,42,70,.08),0 .14cqh .14cqh rgba(0,42,70,.05);
  --am-e2:0 1.1cqh 2.8cqh rgba(0,42,70,.13),0 .28cqh .56cqh rgba(0,42,70,.07);
  --am-e3:0 2.8cqh 6.1cqh rgba(0,42,70,.20),0 .83cqh 1.7cqh rgba(0,42,70,.09)}
.am-hv{--e:var(--am-e0);--y:0px;transform:translateY(var(--y));transition:transform .22s cubic-bezier(.22,.61,.36,1)}
.am-sh{position:absolute;inset:0;pointer-events:none;box-shadow:var(--e);transition:box-shadow .22s cubic-bezier(.22,.61,.36,1)}
.am-hv[data-rest="1"]{--e:var(--am-e1);--y:-.14cqh}
.am-hv[data-rest="2"]{--e:var(--am-e2);--y:-.56cqh}
.am-hv[data-rest="3"]{--e:var(--am-e3);--y:-1.1cqh}
.am-play .am-hv[data-hover=lift]:is(:hover,.am-hov){--e:var(--am-e2);--y:-.56cqh}
.am-play .am-hv[data-hover=lift][data-lift="1"]:is(:hover,.am-hov){--e:var(--am-e1);--y:-.14cqh}
.am-play .am-hv[data-hover=lift][data-lift="3"]:is(:hover,.am-hov){--e:var(--am-e3);--y:-1.1cqh}
/* text/line keep the legacy look when there is no .am-sh */
.am-play .am-hv[data-hover=lift]:not(:has(>.am-sh)):is(:hover,.am-hov){filter:drop-shadow(0 1.8cqh 2.4cqh rgba(0,30,50,.28))}
.am-play .am-hv[data-hover=zoom]:is(:hover,.am-hov){transform:translateY(var(--y)) scale(1.06)}
.am-play .am-hv[data-hover=glow]:is(:hover,.am-hov){filter:drop-shadow(0 0 1.8cqh rgba(247,140,22,.6))}  /* never on glass: UI hides it */
.am-play .am-hv[data-hover]{transition:transform .35s cubic-bezier(.22,.61,.36,1),filter .35s}
.am-play .am-rot:has(>.am-hv[data-hover=tilt]),.am-rot:has(>.am-hv[data-depth]){perspective:900px}
.am-play .am-hv[data-hover=tilt],.am-hv[data-depth]{transform-style:preserve-3d}
.am-play .am-hv[data-hover=tilt]::before{/* same glare as today, moved from .am-fxw */}
.am-hv.am-press{--y:0px;scale:.985;transition-duration:.08s}

/* Glow layer (DTS 06 ring, A&M orange) */
.am-glow{position:absolute;inset:0;pointer-events:none;--g:247,140,22;opacity:.6;transition:opacity .4s;
  box-shadow:0 0 0 .28cqh rgba(var(--g),.55),0 0 3.6cqh 1.1cqh rgba(var(--g),.5),0 0 7.8cqh 1.9cqh rgba(var(--g),.16)}
.am-glow[data-c=s]{--g:126,161,195}
.am-glow[data-g="1"]{opacity:.75}
.am-play .am-glow[data-g="2"]{animation:amGlowP 3s ease-in-out infinite}
@keyframes amGlowP{0%,100%{opacity:.5;scale:.995}50%{opacity:1;scale:1.006}}
.am-play .am-hv:is(:hover,.am-hov)>.am-glow{opacity:1}

/* Sweep layer (DTS 06) */
.am-sweep{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:4}
.am-sweep::before{content:"";position:absolute;inset:0;opacity:0;background-size:300% 100%;background-position:100% 0;background-repeat:no-repeat;
  background-image:linear-gradient(115deg,transparent 38%,rgba(255,255,255,.10) 44%,rgba(255,255,255,.5) 50%,rgba(247,140,22,.42) 55%,transparent 62%);mix-blend-mode:screen}
.am-sweep[data-tone=l]::before{mix-blend-mode:normal;
  background-image:linear-gradient(115deg,transparent 40%,rgba(247,140,22,.10) 46%,rgba(247,140,22,.24) 50%,rgba(126,161,195,.18) 54%,transparent 60%)}
.am-sweep.is-run::before{opacity:1;animation:amSweepRun 1.1s cubic-bezier(.65,0,.35,1) forwards}
@keyframes amSweepRun{from{background-position:100% 0}to{background-position:0 0}}

/* Edit mode: show static layers, no motion */
.am-edit .am-glow{animation:none}
.am-edit .am-sweep{display:none}
.am-edit .am-el[data-step]::after{content:attr(data-step);position:absolute;left:-1.2cqh;top:-1.2cqh;width:2.4cqh;height:2.4cqh;border-radius:50%;
  background:#F78C16;color:#002A46;font:700 1.5cqh/2.4cqh 'Roboto Condensed',sans-serif;text-align:center;pointer-events:none;z-index:9}

/* Reduced motion: join the existing block */
@media (prefers-reduced-motion:reduce){ .am-glow{animation:none!important;opacity:.8} .am-sweep{display:none} .am-hv[data-depth]{transform:translateY(var(--y))!important} }
```
Browser support: individual `scale`/`translate` work in Chrome/Edge 104+, Safari 14.1+ and Firefox 72+. `:has` works in Chrome 105+, Safari 15.4+ and Firefox 121+, and Canteiro already relies on it.

### 5.4 Editor panel ("Animação" section), labels in pt-BR
Replace the current single block (editor.js ~l.384–387) with five collapsible `<details class="sec">` blocks. Each `<summary>` shows the current value in orange, e.g. "Camadas do efeito · Glow, Varredura 5 s". Chips reuse `.chip`/`.chip.on` (orange fill, navy text) and `data-set` paths, so `applyProp` works unchanged except for the numeric parsing note below.

1. **Entrada.** Existing select + `Atraso (ms)` + `Duração (ms)`, plus:
   - `Velocidade` chips: `0,5×` `0,75×` `1×` `1,5×` `2×` (`data-set="anim.spd"`);
   - `Quando` chips: `Com o slide` (0), `Ao avançar` (shows a 1–9 stepper, `anim.step`).
   - Helper text: "No modo apresentação, cada “Avançar” (→ ou Espaço) revela o próximo grupo antes de trocar de slide."
2. **Ênfase.** Chips `Nenhuma` `Varrer luz` `Pulsar 1×` `Holofote` `Elevar` `Recontar`. `Recontar` appears only when the element contains `[data-count]` (counter kinds). `Quando`: `Após a entrada` (0) | `Ao avançar` n (`anim.emphAt`).
3. **Efeito contínuo.** Existing chips (Nenhum, Pulsar, Flutuar, Brilho, Reflexo) and the P1 additions in §7. Plus `Repetir`: `Sempre` (0) `3×` `1×` (`anim.rep`), shown only when loop ≠ none.
4. **Ao passar o mouse (na apresentação).** Existing chips. When `Elevar` is on and the element is BOX: `Repouso` `0` `1` and `Destaque` `1` `2` `3` (DTS 05 labels).
   - Caption: "No tour automático o destaque é simulado — funciona mesmo sem mouse no projetor."
5. **Camadas do efeito** (BOX only). Three rows:
   - `Glow` toggle, which opens `Fixo` | `Pulsante` and `Cor` `Laranja` | `Steel`;
   - `Varredura` chips: `Desligada` `Na entrada` `3 s` `5 s` `8 s`;
   - `Profundidade 3D` chips: `Plano` `Sutil` `Forte`.
   - Glass shows an inline note for Glow: "Indisponível em vidro (o desfoque do fundo seria perdido)."

Buttons: keep `▶ Ver animação no slide`, which now plays the new layers (sweep "Na entrada" fires once, and periodic sweeps fire once at 1.2 s). Add `↻` to replay.

- **Numeric parsing:** `applyProp` already turns `/^-?\d+(\.\d+)?$/` into numbers except for `anim.in`. That covers `spd` 0.75 and `sweep` −1.
- **Batch actions** (menu "Animar slide em sequência", editor.js l.522/531): leave `step` untouched. Add a new action, **"Revelar ao avançar, um por um"**: sort as today, then set `step = i+1` and `delay = 0`.

---

## 6. (b) Presenter control dock in the exported player

### 6.1 UI
- **Inline (bar centre, after `Próximo →`):** a 1 px separator, then three `.amp-b` icon buttons, then the popover toggle:
  - `❚❚` (title "Pausar efeitos (P)"; shows `▶` when paused, `aria-pressed`);
  - `↻` ("Reiniciar efeitos do slide (R)");
  - a speed button showing the current value `1×` ("Velocidade (− / +)"), which cycles the speed list on click;
  - `✦ Efeitos ▾` (`aria-expanded`), which toggles the popover.
- **Popover `.amp-fxp`:** fixed `bottom:60px; right:18px; width:min(360px, calc(100vw - 32px))`. Background `#001E32`, border `1px rgba(255,255,255,.14)`, radius 12, shadow `0 18px 48px rgba(0,0,0,.45)`. Rows use a label in Roboto Condensed 10.5 px caps `#7EA1C3` letter-spacing .14em:
  - `REPRODUÇÃO`: `❚❚ Pausar` · `‹ Passo` · `Passo ›` · `↻ Reiniciar efeito`
  - `VELOCIDADE`: chips `0,25×` `0,5×` `1×` `1,5×` `2×`
  - `CAMADAS DO EFEITO`: toggles `Glow` `Varredura` `Profundidade` `Contínuos` (all on by default)
  - Bottom row: `Tour automático` toggle (left) · `✦ Varrer agora` primary (right: bg `#F78C16`, text `#002A46`, hover `#E07A0A`)
  - Footer hint (JetBrains Mono 10.5 px, `#7EA1C3`): `P pausar · R reiniciar · T tour · V varrer · ? atalhos`

  Chips: height 28, radius 8, border `rgba(255,255,255,.22)`, text `#C9D6E8`. `.is-on` = `#FFFFFF` background with `#002A46` text (DTS dark style). Focus ring: `outline:2px solid #F78C16; outline-offset:2px`.
- **HUD `.amp-hud`:** inside `.amp-view`, `position:absolute; right:16px; top:14px`. JetBrains Mono 11 px, background `rgba(0,20,36,.72)`, border `1px rgba(255,255,255,.14)`, radius 8, padding 5×9.
  - Persistent while paused, speed ≠ 1 or tour on, e.g. `❚❚ pausado · 0,5× · t 2,40 s`.
  - Transient messages fade after 1.4 s (`Glow desligado`, `Tour pausado — você assumiu`, `Varredura ✦`).
  - `aria-live="polite"`.
- **Restart fade `.amp-fade`:** a navy (`#00192b`) overlay over the deck, `opacity 0→1` in .26 s.
- **Responsive.**
  - At `max-width:760px`: hide `.amp-brand span` (deck title) and the text of `← Anterior`/`Próximo →` (arrows only), and keep `❚❚ ↻ 1× ✦`.
  - At `max-width:520px`: the popover becomes a bottom sheet (`left:8px; right:8px; bottom:60px; width:auto`) and chips wrap.
  - No horizontal scroll at 390 px (acceptance test).
- **Help overlay `?`:** a modal listing all keys (§6.2) in a 2-column `kbd` table. Esc closes it.

### 6.2 Keyboard (player). Keep the existing keys, add the rest
| Key | Action |
|---|---|
| → · PageDown · Space · Enter · click right 18% | **Avançar**: reveal the next build group; if none, go to the next slide (also resumes if paused) |
| ← · PageUp · Backspace · click left 18% | Previous slide, shown **already built** (§6.3.6) |
| Home / End · F · Esc | unchanged |
| **P** (alias **K**) | Pausar / Retomar efeitos |
| **.** / **,** | Passo à frente / atrás (seek ±500 ms of effect time; pauses first if playing) |
| **R** | Reiniciar efeitos do slide (fade 280 ms, builds reset, unpauses) |
| **−** / **=** (or **+**), **0** | Velocidade down / up through `[0.25, 0.5, 1, 1.5, 2]`; 0 → 1× |
| **T** | Tour automático on/off |
| **G** | Glow on/off (deck-wide layer) |
| **V** | Varrer agora |
| **D** | Profundidade 3D on/off |
| **?** | Atalhos |

- **Reserved for other user items (do not bind here):** `I` (índice), `N` (resumo/notas), `C` (comentários), `E` (editar), `Z` (ampliar gráfico). If those specs choose other letters, these dock letters still do not collide.
- Handler guard: `if (e.target && (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable)) return;` and also ignore keys when `e.ctrlKey||e.metaKey||e.altKey` (Ctrl+S, Ctrl+Z, etc. belong to the editable deck).

### 6.3 Runtime engine (`runtime.js`)

#### 6.3.1 Pausable clock (replaces `performance.now()`/`setInterval` in `runFx`)
```js
function mkClock() {
  var c = { t: 0, rate: 1, paused: false, subs: [], raf: 0, last: 0 };
  function loop(now) {
    var dt = c.last ? Math.min(64, now - c.last) : 0; c.last = now;     // DTS: dt clamped to 64 ms
    if (!c.paused && !document.hidden) c.t += dt * c.rate;
    for (var i = 0; i < c.subs.length; i++) c.subs[i](c.t, dt);
    c.raf = c.subs.length ? requestAnimationFrame(loop) : (c.last = 0);
  }
  c.on = function (fn) { c.subs.push(fn); if (!c.raf) c.raf = requestAnimationFrame(loop); return function () { var k = c.subs.indexOf(fn); if (k >= 0) c.subs.splice(k, 1); }; };
  c.every = function (ms, fn, first) { var next = c.t + (first == null ? ms : first);
    return c.on(function (t) { if (t >= next) { next = Math.max(next + ms, t + 1); fn(); } }); };
  c.after = function (ms, fn) { var at = c.t + ms, off = c.on(function (t) { if (t >= at) { off(); fn(); } }); return off; };
  c.seek = function (d) { c.t = Math.max(0, c.t + d); };
  return c;
}
var CLOCK = mkClock();   // default clock for the editor and drawer previews: never paused
```
- `runFx(root, clk, opts)`: same queries as today, but on `root` (so it works for a single `.am-el`), skipping held build elements (`closest('.am-el[data-step]:not(.am-go)')`).
  - Counters: `t0 = clk.t + delay/spd + 250`, `dur = 1500/spd`, with `p = (t - t0)/dur` inside `clk.on`. The subscription stays alive until cleanup, so seeking backwards re-renders correctly.
  - `opts.done` writes the final values immediately.
  - Cycles: `clk.every(1400, …, 1400)` and `clk.every(2200, …, 1900)`.
  - The return value stays a cleanup function. Callers that pass nothing get `CLOCK`, so `editor.js` keeps working unchanged.
- `visibilitychange` needs no special handling: the clock already skips while `document.hidden`. Also add `.am-paused` to the stage while hidden to stop CSS work.

#### 6.3.2 Speed: WAAPI playback rate
```js
function syncRate(root, clk) {
  root.querySelectorAll('.am-el').forEach(function (n) {
    var r = clk.rate * (+n.dataset.spd || 1);
    n.getAnimations({ subtree: true }).forEach(function (a) { if (a.playbackRate !== r) a.playbackRate = r; });
  });
}
```
- `getAnimations()` flushes style, so calling `syncRate` right after any class toggle (`am-in`, `am-go`, `is-run`) also catches animations created by that toggle.
- Call it after `go()`, `reveal()`, `restart()`, `sweep()` and on every speed change. **Never call it per frame.**
- Per-element `spd` is compensated in `renderEl` by pre-scaling `--d` (`delay × spd`). The element still starts at its absolute delay, while its internal staggers (`var(--i)*110ms`) and duration speed up.
- Hover transitions are user feedback and stay at 1×.
- Measured in Canteiro: `{"n":16,"names":"amFade,amGrow,amRise,amPulse,amBar","delta":[100,…]}`, i.e. 400 ms real at rate 0.25 → 100 ms anim. (`waapi.js`)

#### 6.3.3 Pause
```css
.am-paused .am-el,.am-paused .am-el *,.am-paused .am-el *::before,.am-paused .am-el *::after{animation-play-state:paused!important}
```
```js
function setPaused(on) { P.paused = on; clk.paused = on; list[cur].st.classList.toggle('am-paused', on); ui.pause(on); hud(); }
```
- Measured: after adding the class, `playState:"paused"` and Δ≈4 ms in 300 ms. After removing it, `"running"`.
- Use the CSS class, **not** `a.pause()`. A WAAPI pause would override CSS and survive class removal.

#### 6.3.4 Step (seek)
```js
function stepBy(ms) { if (!P.paused) setPaused(true);
  list[cur].st.getAnimations({ subtree: true }).forEach(function (a) {
    var e = a.effect && a.effect.getComputedTiming(); if (!e) return;
    var end = isFinite(e.endTime) ? e.endTime : Infinity; a.currentTime = Math.max(0, Math.min(end, (a.currentTime || 0) + ms));
  });
  clk.seek(ms); }
```
Measured (`seek.js`): a paused `amRise` (2000 ms) seeks 0 → 500 (opacity 0 → .59), holds at 500 after 300 ms, then goes back to 100 (opacity .14).

#### 6.3.5 Builds: Ordem / Avançar
```css
.am-play .am-el[data-step]:not(.am-go){visibility:hidden}
.am-stage.am-in .am-el[data-step]:not(.am-go),.am-stage.am-in .am-el[data-step]:not(.am-go) *{animation-name:none!important}
```
- When `.am-go` is added, `animation-name` goes from none to the real one, so entrance **and** component internals start fresh at the click. Their `--d` delays are relative to the click.
```js
function groups(st) { var s = []; st.querySelectorAll('.am-el[data-step],.am-el[data-emph-at]').forEach(function (n) {
  [n.dataset.step, n.dataset.emphAt].forEach(function (k) { k = +k; if (k && s.indexOf(k) < 0) s.push(k); }); }); return s.sort(function (a, b) { return a - b; }); }
function advance() { var st = list[cur].st, g = groups(st); if (P.built >= g.length) return false;
  var k = g[P.built++];
  st.querySelectorAll('.am-el[data-step="' + k + '"]').forEach(function (n) { n.classList.add('am-go'); P.cleans.push(runFx(n, clk)); armLayers(n); });
  st.querySelectorAll('.am-el[data-emph-at="' + k + '"]').forEach(emphasize);
  syncRate(st, clk); return true; }
function next() { if (P.paused) setPaused(false); if (!advance()) go(cur + 1); }
```
- `go(i)` resets `P.built = 0`, removes `.am-go` and `.am-lit`/`.am-spot`, cleans previous `runFx`/timers, and keeps the existing `am-pre`→`am-in` logic.
- The click zone and `Próximo →` call `next()` instead of `go(cur+1)`. Its title becomes "Avançar (→ / Espaço)".
- The "Próximo" button stays enabled on the last slide while groups are pending.

#### 6.3.6 Back = already built
```js
function finishAll(st) { st.querySelectorAll('.am-el[data-step]').forEach(function (n) { n.classList.add('am-go'); });
  st.getAnimations({ subtree: true }).forEach(function (a) { var e = a.effect && a.effect.getComputedTiming(); if (e && isFinite(e.endTime)) a.finish(); }); }
// prev(): go(cur-1, {built:true}) → after am-in: finishAll(st); runFx(st, clk, {done:true}); P.built = groups(st).length
```
- Never call `finish()` on infinite animations: it throws `InvalidStateError`, hence the `endTime` guard.
- Loops keep running.

#### 6.3.7 Restart
```js
function restart() { var o = list[cur], f = wrap.querySelector('.amp-fade'); f.classList.add('on');
  /* real time (setTimeout), not the slide clock: the fade must also run while paused */
  setTimeout(function () { cleanAll(); P.built = 0; o.st.classList.remove('am-in', 'am-spot'); o.st.querySelectorAll('.am-go,.am-lit,.am-hov').forEach(function (x) { x.classList.remove('am-go', 'am-lit', 'am-hov'); });
    o.st.classList.add('am-pre'); void o.st.offsetWidth; o.st.classList.remove('am-pre'); o.st.classList.add('am-in');
    P.cleans.push(runFx(o.st, clk)); armLayers(o.st); syncRate(o.st, clk); setPaused(false); f.classList.remove('on'); }, 280); }
```

#### 6.3.8 Layers: glow, sweep, depth, loops (deck-wide toggles)
- Classes go on `.amp`: `am-noglow`, `am-nosweep`, `am-flat` and `am-noloop`.
```css
.am-noglow .am-glow{display:none} .am-noglow .am-fxw[data-loop=glow]{animation:none} .am-noglow .am-hv[data-hover=glow]:is(:hover,.am-hov){filter:none}
.am-nosweep .am-sweep{display:none}
.am-flat .am-hv[data-depth],.am-flat .am-hv[data-hover=tilt]{transform:translateY(var(--y))!important} .am-flat .am-rot{perspective:none!important}
.am-noloop .am-fxw[data-loop],.am-noloop .am-glow{animation:none!important}
```
- `armLayers(root)` schedules sweeps for the elements entering now:
```js
function sweep(sw) { sw.classList.remove('is-run'); void sw.offsetWidth; sw.classList.add('is-run'); syncRate(sw.closest('.am-stage'), clk); }
// stage-level: st.addEventListener('animationend', e => { if (e.animationName === 'amSweepRun') e.target.classList.remove('is-run'); });
function armLayers(root) { root.querySelectorAll('.am-sweep[data-every]').forEach(function (sw) {
  var n = sw.closest('.am-el'), spd = +n.dataset.spd || 1, enter = (parseFloat(n.style.getPropertyValue('--d')) || 0) / spd + (parseFloat(n.style.getPropertyValue('--t')) || 700) / spd + 150;
  if (sw.dataset.every === 'in') P.cleans.push(clk.after(enter, function () { sweep(sw); }));
  else P.cleans.push(clk.every(+sw.dataset.every * 1000, function () { sweep(sw); }, enter)); }); }
```
- **Varrer agora (V)** sweeps every `.am-sweep` on the current slide, resetting each periodic countdown (store `next` per element, as in DTS). If the slide has none, it runs a **slide-wide sweep**: a stage overlay `.am-ssweep` with the same keyframe and the light tone at 50% alpha. The key therefore always gives feedback.
- **Depth driver** (replaces `bindTilt`; DTS 04 lerp + orbit):
```js
function bindDepth(deckEl, clk) { var on = []; // {hv, amp, cur:{x,y}, tgt:{x,y}, ptr:false}
  function collect(st) { on = Array.from(st.querySelectorAll('.am-hv[data-depth],.am-hv[data-hover=tilt]')).map(function (hv) { return { hv: hv, amp: +hv.dataset.depth || 0, cur: { x: 0, y: 0 }, tgt: { x: 0, y: 0 }, ptr: false }; }); }
  deckEl.addEventListener('pointermove', function (e) { on.forEach(function (o) { var r = o.hv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    o.ptr = x >= 0 && x <= 1 && y >= 0 && y <= 1; if (o.ptr) { var k = o.amp === 2 ? [18, 22] : [14, 16]; o.tgt = { x: (.5 - y) * k[0], y: (x - .5) * k[1] }; o.hv.style.setProperty('--mx', x * 100 + '%'); o.hv.style.setProperty('--my', y * 100 + '%'); } }); });
  clk.on(function (t) { var flat = deckEl.closest('.amp').classList.contains('am-flat');
    on.forEach(function (o) { if (flat) { o.hv.style.transform = ''; return; }
      if (!o.ptr) o.tgt = o.hv.classList.contains('am-hov') ? { x: 6, y: -8 } : (o.amp ? { x: Math.cos(t / 3400) * 2 * o.amp, y: Math.sin(t / 2600) * 5 * o.amp } : { x: 0, y: 0 });
      o.cur.x += (o.tgt.x - o.cur.x) * .11; o.cur.y += (o.tgt.y - o.cur.y) * .11;
      o.hv.style.transform = 'translateY(var(--y)) rotateX(' + o.cur.x.toFixed(2) + 'deg) rotateY(' + o.cur.y.toFixed(2) + 'deg)'; }); });
  return collect; }  // call collect(st) inside go()
```
The lerp runs per frame even when paused, so pointer tilt stays responsive; the orbit phase freezes because `t` does.

#### 6.3.9 Emphasis (`emphasize(n)`)
- `sweep`: `sweep(n.querySelector('.am-sweep'))`.
- `beat`: add `.am-beat` to `.am-hv`, with `@keyframes amBeat1{50%{scale:1.06}}` .7 s plus a ring `amRingC` on `.am-glow`/`.am-sh`. Remove it on `animationend`.
- `spot`: add `.am-spot` to the stage and `.am-lit` to `n`. CSS `.am-stage.am-spot .am-el:not(.am-lit)>.am-rot{opacity:.28;transition:opacity .45s}`. Opacity goes on `.am-rot`, so entrance fills are untouched. The spot clears on the next group or slide.
- `raise`: set `n`'s `.am-hv` `data-rest="3"` until the next group.
- `recount`: `runFx(n, clk)` again (counters restart from 0).
- `emphAt = 0`: schedule with `clk.after(entranceEnd + 200, …)`.

#### 6.3.10 Tour automático
```js
var TOUR_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 3200 : 2600, SLIDE_MIN = 6000;  // DTS 38 dwell
function setTour(on, why) { P.tour && P.tour(); P.tour = null; P.hovI = 0; setHov(null); ui.tour(on);
  if (on) { if (P.paused) setPaused(false); P.tour = clk.every(TOUR_MS, tourTick); } hud(why); }
function tourTick() {
  if (advance()) return;                                             // 1) pending build groups
  var hv = list[cur].st.querySelectorAll('.am-hv[data-hover],.am-hv[data-depth]');
  if (P.hovI < hv.length) { setHov(hv[P.hovI++]); return; }           // 2) simulated hover, one per tick
  setHov(null);
  if (clk.t - P.enteredAt < SLIDE_MIN) return;                        // 3) reading time
  if (cur < list.length - 1) go(cur + 1); else setTour(false, 'Fim da apresentação'); }
function setHov(hv) { list[cur].st.querySelectorAll('.am-hov').forEach(function (x) { x.classList.remove('am-hov'); }); if (hv) hv.classList.add('am-hov'); }
```
- **Stop on takeover** (DTS contract): any nav key, a click on the deck, the `‹/›` buttons, or `pointerenter` on an `.am-hv` call `setTour(false,'Tour pausado — você assumiu')`. The tour button itself and the speed and layer toggles do **not** stop it.
- Pausing pauses the tour, because it runs on the clock. Speed scales it.
- `go()` sets `P.enteredAt = clk.t` and `P.hovI = 0`.

#### 6.3.11 Persistence
- Dock preferences (`speed`, `noglow`, `nosweep`, `flat`, `noloop`) go to `localStorage['amrt.dock']`, wrapped in try/catch, and are restored on `player()` start.
- Pause and tour are never persisted.
- **Exported HTML:** nothing extra; the player call is unchanged (`AMRT.player(deck, root, {brand})`).

### 6.4 Player bar HTML delta
```js
'<div class="amp-c"><button class="amp-b" data-a="prev" …>← Anterior</button><span class="amp-pos">…</span><button class="amp-b" data-a="next" title="Avançar (→ / Espaço)">Próximo →</button>' +
'<span class="amp-sep" aria-hidden="true"></span>' +
'<button class="amp-b amp-ic" data-a="pause" aria-pressed="false" title="Pausar efeitos (P)" aria-label="Pausar efeitos">❚❚</button>' +
'<button class="amp-b amp-ic" data-a="restart" title="Reiniciar efeitos do slide (R)" aria-label="Reiniciar efeitos">↻</button>' +
'<button class="amp-b amp-spd" data-a="speed" title="Velocidade (− / +)">1×</button>' +
'<button class="amp-b amp-ic" data-a="fx" aria-expanded="false" aria-controls="ampFxp" title="Controles de efeito">✦ <span class="amp-tx">Efeitos</span></button></div>'
```
Popover markup is appended to `.amp` (sibling of `.amp-bar`) as `<div class="amp-fxp" id="ampFxp" role="dialog" aria-label="Controles de efeito" hidden>`. The click handler extends the existing `wrap` delegate: `pause speed restart fx stepb stepf tour sweep glow layer:*`. Clicks inside the popover must not reach the deck click zones; it lives outside `.amp-deck`, so the existing `deckEl.contains` check already handles that.

---

## 7. Mapping the 40 guide effects into Canteiro

Destinations:
- **CTRL**: a dock/runtime feature;
- **ENT**: entrance; **EMPH**: emphasis; **LOOP**: continuous; **HOV**: hover or click;
- **TRN**: slide transition; **BG**: live slide background;
- **CMP**: new component in `AMRT.FX`; **UPG**: upgrade of an existing component;
- **TOOL**: presenter tool; **—**: not ported.

Priority: P0 = this iteration (controls), P1 = next, P2 = later.

| # | Effect | → Canteiro | Pri | Notes / Canteiro name (pt-BR) |
|---|---|---|---|---|
| 01 | Motion Graphics | CTRL + TRN + CMP | P0/P2 | Timeline model gives the clock, pause, speed, seek and restart fade (P0). TRN **"Passagem navy"** (fade through `#00192b`, 280 ms). CMP **"Abertura de capítulo"** (variants `full`, `title`, `minimal`). |
| 02 | Icon Motion | ENT + HOV + CTRL | P1 | ENT **"Desenhar ícone"** (`getTotalLength` dashoffset 900 ms, 110 ms stagger; for SVG icons from item 3's icon library). HOV **"Ícone vivo"** (lift/pulse/spin/layers/gear by icon). Tour pattern → dock tour. |
| 03 | Hologram 3D Cards | CTRL + UPG + HOV + ENT | P0/P1 | "Camadas do efeito" UI (P0). `holo` gets inner translateZ depth plus glare/sweep layers. HOV **"Holograma"** (tilt + glare + sweep). ENT **"Pouso 3D"** (outBack 700 ms from rotateX −24°/rotateY 20°). |
| 04 | 3D Tilt / Perspective | CTRL + CMP | P0/P2 | "Profundidade" layer and dock `D` (P0). CMP **"Pilha de arquitetura 3D"** (variants `build`, `orbit`, `focus`; depth chips Compacta/Normal/Explodida). |
| 05 | Hover Elevation | CTRL | P0 | Repouso/Destaque elevation 0–3 (§5.3), press feedback. |
| 06 | Glow / Light Sweep | CTRL + EMPH | P0 | Glow and Varredura layers, dock `G`/`V`. EMPH **"Varrer luz"**. |
| 07 | Glassmorphism | UPG | P2 | `glass` gets a blur intensity field (8–24 px) and `Borda`/`Brilho` toggles. |
| 08 | Animated Gradient | CTRL + BG + LOOP | P0/P2 | Phase clock (P0). BG **"Gradiente vivo"** (orbs, 24 s cycle). LOOP **"Gradiente vivo"** for shapes/cards. |
| 09 | Parallax | BG | P2 | BG **"Parallax de camadas"**: elements get a depth factor (0.015–0.13) by z-order; cursor plus idle drift; respects `am-flat`. |
| 10 | Reveal / Mask Reveal | ENT + TRN | P1 | ENT **"Íris"** (`clip-path:circle(0→75%)`) and **"Diagonal"** (`polygon`). TRN **"Íris"**. "Cortina" already exists (`wipe`). |
| 11 | Animated Typography | ENT | P1 | Text entrances **"Palavra a palavra"**, **"Letra a letra"**, **"Linha a linha"** (bullets included), using the `headline` component's word-split approach on any text element (`--i` per span, 70 ms stagger). |
| 12 | Counter Animation | UPG + EMPH | P1 | Counter field `Easing` (Linear / Out Cubic / Out Expo) and duration. EMPH **"Recontar"**. |
| 13 | Progress Motion | UPG | P2 | `progress` gets **Meta** and **Ciclo anterior** overlays (ghost bar). |
| 14 | Heatmap Animation | CMP | P2 | **"Mapa de calor"** (variants `cells` cold→hot, `sort`, `hot`). |
| 15 | Data Highlight | EMPH + UPG | P1 | EMPH **"Holofote"** generalises dimming. `bars`/`linechart` get variant `insights` (each Avançar lights the next insight group). |
| 16 | Chart Build Animation | UPG | P2 | `bars`/`linechart` get variant `byx` (build by X axis). |
| 17 | BPMN Flow Motion | CTRL + CMP | P0/P2 | Dock "Passo" (P0). CMP **"Fluxo BPMN com token"** (variants `token`, `steps`, `draw`). |
| 18 | Connector / Flow Line | LOOP | P1 | Line loops **"Fluxo contínuo"** (dash 6 6, 1.1 s) and **"Pacotes"** (dots along `getPointAtLength`). |
| 19 | Pulse / Beacon | LOOP + UPG + CTRL | P1 | LOOP **"Beacon"** (2–3 rings, `--period` 2.2/3.2 s) for any element. `beacon` gets tour notes. Tour pattern → dock. |
| 20 | Ripple Interaction | HOV | P2 | **"Ondulação ao clicar"** (presentation clicks on clickable elements). |
| 21 | Flip Card | CMP + ENT + HOV | P2/P1 | CMP **"Card de duas faces"** (variants `click`, `auto`, `all`). ENT **"Virar 3D"** (reuse `amFlip`). HOV **"Virar ao clicar"** (any card element with an optional back text: `rotateY(180deg)` .7 s on `.am-hv`, `backface-visibility:hidden`). |
| 22 | Expandable Card | CMP | P2 | **"Lista expansível"** (variants `click`, `auto`). |
| 23 | Modal Focus | TOOL | P1 | Player **"Ampliar"** on a clicked element: blurred backdrop, scaled clone. Shared with item 8 (ampliar gráficos); coordinate with that spec. |
| 24 | Spotlight / Focus | EMPH + TOOL | P1 | EMPH **"Holofote"**. Optional presenter spotlight following the cursor (not bound in this doc). |
| 25 | Magnetic Button | HOV | P2 | **"Magnético"** (radius 130 px, strength .4, spring back). |
| 26 | Microinteractions | CTRL (technique only) | — | `--k` duration multiplier, superseded by WAAPI rate. No visual port (UI-only feedback). |
| 27 | Scroll Reveal | — | — | No scrolling in slides; covered by ENT "Linha a linha" + builds. |
| 28 | Sticky Storytelling | CMP | P2 | **"Narrativa em fases"** (variants `steps` (Avançar changes phase), `auto`). |
| 29 | Morphing Shapes | CMP + TRN | P2 | CMP **"Morph AS-IS → TO-BE"** (variants `silos-hub`, `hub-mesh`, `cycle`). TRN **"Morph"** (FLIP tween of elements with the same `id`/name between consecutive slides). |
| 30 | Particle System | BG | P2 | BG **"Partículas"** (canvas; density 45/90/160; dose 3, capas only). |
| 31 | Shimmer / Holographic Sweep | (exists) | — | Covered by loop "Reflexo" plus the Varredura layer and "Varrer agora". |
| 32 | Floating Elements | LOOP + CTRL | P1 | LOOP **"Flutuação orgânica"** (per-element random period 4–8.6 s and amplitude; stops in 300 ms on hover/tour). Tour pattern → dock. |
| 33 | Card Stack | CMP | P2 | **"Pilha de cards"** (variants `click`, `auto`). |
| 34 | Carousel | — | — | Scroll UI; replaced by "Pilha de cards" + builds. |
| 35 | Interactive Matrix | UPG | P2 | `matrix` bubbles draggable in presentation, click quadrant to highlight. |
| 36 | Tooltip / Contextual Info | HOV | P1 | **"Nota contextual"**: new element field `tip` shown on hover/click in presentation, auto-positioned (flip above/below), included in tour. |
| 37 | Before / After Slider | CMP | P2 | **"Antes / Depois"** (variants `drag`, `animate`). |
| 38 | Timeline Motion | CTRL + UPG | P0/P2 | Autoplay/dwell 2600 ms → tour; Anterior/Próximo/Reiniciar → dock. `timeline` gets variant `cards` (milestone card per Avançar). |
| 39 | Node Network Motion | CMP | P2 | **"Rede de nós"** (variants `float`, `focus`, `build`). |
| 40 | Animated Shader / Hero | CTRL + BG | P0/P2 | "Congelar" = Pausar (P0). BG **"Shader"** (WebGL with 2D fallback, dose 3). |

**Size note (P2).** Each guide demo is about 10–25 KB of HTML+CSS+JS. Eleven new components plus four backgrounds would add roughly 150–250 KB to every exported deck. Recommend a per-kind pack (`AMRT.PACKS[kind] = {css, js}`) so that `exportHTML` inlines only the kinds a deck uses.

---

## 8. How many effects Canteiro would offer

| Family | Today | Added | Proposed | Added items (pt-BR UI names) |
|---|---|---|---|---|
| Entrada | 8 | +8 | **16** | Íris, Diagonal, Palavra a palavra, Letra a letra, Linha a linha, Desenhar ícone, Pouso 3D, Virar 3D |
| Ênfase (new family) | 0 | +5 | **5** | Varrer luz, Pulsar 1×, Holofote, Elevar, Recontar |
| Efeito contínuo | 4 | +5 | **9** | Beacon, Fluxo contínuo, Pacotes, Flutuação orgânica, Gradiente vivo |
| Ao passar o mouse / clique | 4 | +6 | **10** | Holograma, Ícone vivo, Magnético, Virar ao clicar, Nota contextual, Ondulação ao clicar |
| Transição de slide | 3 | +3 | **6** | Passagem navy, Íris, Morph |
| Fundo vivo (new family) | 0 | +4 | **4** | Gradiente vivo, Parallax de camadas, Partículas, Shader |
| Camadas do efeito (modifiers) | 0 | +4 | **4** | Glow, Varredura, Profundidade 3D, Elevação (Repouso/Destaque) |
| **Element/slide effects subtotal** | **19** | +35 | **54** | |
| Componentes (kinds) | 21 | +11 | **32** | Abertura de capítulo, Pilha de arquitetura 3D, Mapa de calor, Fluxo BPMN com token, Card de duas faces, Lista expansível, Narrativa em fases, Morph AS-IS→TO-BE, Pilha de cards, Antes/Depois, Rede de nós |
| Component animations (variants; a kind without variants counts as 1) | 51 | +29 new, +5 upgrades | **85** | Upgrades: bars `insights` + `byx`, linechart `byx`, timeline `cards`, progress `meta` |
| **Total distinct effect choices** | **70** | | **139** | about 2× |

Presenter controls (not counted as effects): Pausar, Passo ±, Reiniciar efeito, Velocidade (5 steps), Tour automático, Glow, Varrer agora, Profundidade, Contínuos, Ampliar, Holofote.

**Delivery cut (recommended).**
- **P0:** dock + per-element controls + layers + loop/hover fix (§5–6). Effect count: 19 + 4 layers + 5 emphasis (needed by builds) = 28 effects, plus all controls.
- **P1:** entrances, loops, hovers and transitions, giving 54.
- **P2:** components and backgrounds, giving 139.

---

## 9. Brand mapping (DTS → A&M)

| DTS token | Value | A&M replacement |
|---|---|---|
| navy-950/900/800 | `#04101F` `#071A33` `#0B2545` | `#00192b` (player bg) · `#001E32` · `#002A46` |
| navy-700/600 | `#13315C` `#1B4479` | `#0B3A63` (already in `.fx-dark` gradient) |
| steel-500/400 | `#4A6FA5` `#6E8FBF` | `#43698F` · `#7EA1C3` |
| steel-300/200/100 | `#A3B8D6` `#C9D6E8` `#E4EBF5` | same / `#E3EAF2` |
| orange-500/400/600/200/100 | `#F26B21` `#FF8A4C` `#D9521A` `#FFC7A6` `#FDE8DC` | **only `#F78C16`**; hover `#E07A0A`; tints `#F9C48A`, `#FFF1E3` |
| glow rgb | `242,107,33` | `247,140,22`; steel option `126,161,195` |
| "Crítico"/alert tags | orange-600 text | navy bold + orange dot (never red) |
| Fonts | Inter + JetBrains Mono | Roboto Condensed (labels/titles, dock captions), Inter (body), JetBrains Mono (HUD, kbd, readouts) |
| Primary button | orange bg, white text | orange `#F78C16` bg, **navy `#002A46` text** (matches `.tb.pri`, contrast 5.6:1) |

---

## 10. Acceptance tests (Playwright, add to `test-core.js` / `qa-gate.sh`)

1. **Pause:** in present mode press `P` → every `.amp-slide.on .am-stage` animation has `playState==='paused'`; a counter's text is unchanged after 600 ms; HUD contains "pausado". `P` again → `running`.
2. **Speed:** press `−` once (1× → 0.5×) → an entrance animation's `currentTime` advances 200 ± 40 ms over 400 ms; the button reads `0,5×`; `0` restores `1×`.
3. **Step:** while paused, `.` advances `currentTime` by 500 ± 5 (clamped at end); `,` goes back by 500.
4. **Restart:** `R` → after 400 ms entrance animations have `currentTime < 200`, build groups are reset, and the dock is not paused.
5. **Builds:**
   - a slide with an element `anim.step=1` → that element is `visibility:hidden` and has no running animation;
   - first `→` reveals it (slide index unchanged) and its counters start then;
   - second `→` goes to the next slide;
   - in the editor the step badge "1" is visible.
6. **Back:** `←` → all finite animations of the previous slide are `finished`, counters show final values, and all groups are visible.
7. **Tour:**
   - `T` → within 2.7 s either a group is revealed or one `.am-hov` exists;
   - it reaches the next slide only after ≥ 6 s on the slide;
   - pressing `→` stops it (`aria-pressed="false"` and HUD "Tour pausado — você assumiu").
8. **Glow:** `G` toggles `.am-noglow` on `.amp`; `.am-glow` is `display:none`.
9. **Varrer agora:** `V` → `.am-sweep.is-run` present at 300 ms and gone at 1.3 s. On a slide without sweep layers, `.am-ssweep.is-run` appears instead.
10. **Depth:** `D` → `.am-hv[data-depth]` computed `transform` has no rotation.
11. **Loop + hover regression:** an element with `loop=float` and `hover=zoom`, hovered, has a computed `scale`/`transform` that includes 1.06 (today: fails).
12. **Backward compatibility:** a deck saved before this change (e.g. `saved.html`, `saved-core.html`) opens with identical slide screenshots (pixel diff < 0.5%) and all existing suites pass (`qa-gate.sh`).
13. **safeEl:** `{spd:99, sweep:4, depth:'x', emph:'<img>'}` sanitises to `{spd:1, sweep:0, depth:0}` with `emph` dropped; valid values survive save → reopen.
14. **Keys while editing:** with focus in a `contentEditable` text (item 9), pressing `P`, `R`, `T` or `Space` does not trigger dock actions.
15. **Exported file:** `exportHTML()` output opened from `file://` shows the dock, and all of 1–10 pass there.
16. **Reduced motion** (`page.emulateMedia({reducedMotion:'reduce'})`): no infinite animations are running; the tour still works with a 3200 ms tick.
17. **Mobile 390×844:**
    - `document.documentElement.scrollWidth <= 390`;
    - the popover fits the viewport;
    - the bar shows `❚❚ ↻ 1× ✦` and the arrows.
18. **Glass:** a `glass` element shows no Glow/Elevação controls, and its `.fxg` still has a non-`none` `backdrop-filter` with no `filter` on any ancestor.

---

## 11. Screenshot index (`SHOTS/` = `…/scratchpad/qa-understand/dts-controls/`)
| File | What it shows |
|---|---|
| `00-home.png`, `00-catalog.png` | Guide home and the box catalogue (mini live demos, filters, counts) |
| `01-effect-page-06.png` | Effect page anatomy: header, dose badge, Replay, stage with control bar, info panels |
| `02-mobile-fx01.png` | Guide at 390 px: its stage overflows, a pattern to avoid |
| `fx-01.png`, `fx-01-paused.png` | Motion Graphics: Pausar/Reiniciar/Velocidade/Loop, phase seek, time readout |
| `fx-02.png`, `fx-02-tour.png` | Icon Motion: Redesenhar, Tour automático, Traço speeds |
| `fx-03.png`, `fx-03-hover-all-layers.png` | Hologram: Camadas do efeito (Tilt/Glow/Sweep/Profundidade) |
| `fx-04.png`, `fx-04-explodida-foco.png` | 3D Tilt: Profundidade Compacta/Normal/Explodida, Perspectiva, Órbita, focus |
| `fx-05.png`, `fx-05-demo.png` | Hover Elevation: Repouso/Hover levels, Demonstrar |
| `fx-06.png`, `fx-06-sweep-mid.png` | Glow/Light Sweep: Glow, Sweep, Intervalo, Cor, ✦ Varrer agora (mid-sweep) |
| `fx-08.png` | Animated Gradient: Pausar, Velocidade, Técnica |
| `fx-09.png`, `fx-09-camadas.png` | Parallax: Profundidade Sutil/Normal/Forte, Ver camadas (exploded) |
| `fx-17.png` | BPMN: Pausar, Passo ›, Velocidade, status |
| `fx-19.png` | Beacon: Anéis, Ritmo, Tour automático, Próximo ponto |
| `fx-26.png` | Microinteractions: Velocidade 1× / Câmera lenta 4× (`--k`) |
| `fx-32.png` | Floating Elements: Amplitude, Conexões, Tour automático |
| `fx-38.png` | Timeline: Anterior/Próximo, Autoplay, Reiniciar |
| `fx-40.png` | Shader: Intensidade, Fio laranja, Congelar |
| `c-anim-panel.png`, `c-drawer-fx.png`, `c-player.png` | Canteiro today: Animação panel, effects drawer, player bar |

Data dumps: `meta.json` (all 40 effects' metadata), `controls.json` (every demo control with data-attributes).
