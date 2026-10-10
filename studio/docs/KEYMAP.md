# KEYMAP — unified keyboard map for Canteiro (editor, cover, player, exported file)

Single reference for every shortcut. It reconciles ARCH §12, TMG-FEATURES §6.5 and DTS-CONTROLS §6.2 (decisions already taken: **G = Índice**, **B = Brilho**, I = Resumo, Z = Ampliar).
Labels in the "UI label" column are the exact pt-BR strings to show in buttons, tooltips (`title`), the `?` overlay and the F1 modal.
Status: **today** = shipped; **F0** = shipped in step S0 (Fundação); **Fn** = the step that adds it (F1…F11, see ARCH §11).

---

## 1. Rules for every key handler (all layers)

1. **Typing wins.** Never act on a key whose target is `input`, `textarea`, `select` or `contentEditable` (also `plaintext-only`). The player does this since F0 (`runtime.js`, `key()`). Esc inside a field belongs to the field's own layer (blur or close that panel), not to the player.
2. **Browser and edit-layer combos are not player keys.** `key()` returns on Ctrl, ⌘ (Meta) or Alt (F0). Exception: **AltGr** (`e.getModifierState('AltGraph')`, reported as Ctrl+Alt on Windows) only types characters, so it is not treated as a combo. Shift is allowed (it produces `?`, `+`).
3. **Ctrl/⌘ combos in the exported file** (Ctrl+S, Ctrl+Z, Ctrl+Shift+Z) are handled by the edit layer's **own** listener (F11), which calls `preventDefault()`. Never inside the player's `key()`.
4. **Focused buttons act natively.** When focus is on a `button`, `[role=button]` or `a[href]` (keyboard users, Tab), Enter and Space activate that control and do not advance the slide.
5. **Mouse clicks must not steal Space.** Bar, dock, rail and índice buttons call `preventDefault()` on `mousedown`, so after a click Space/Enter still mean "Avançar".
6. **Letters are case-insensitive** (`g` and `G`). Compare `e.key`, never `keyCode`. Keys that need Shift on some layouts (`?`, `+`) are matched by the produced character.
7. **One topmost layer.** Esc closes only the topmost open layer (§3). A layer that is open owns its arrow keys (§4).
8. **One source per list.** The editor's F1 modal and the cover manual read `HK` (editor.js). The player's `?` overlay should read one array in the runtime (proposal: `AMRT.KEYS = [[keys, label, group], …]`), so the overlay, the dock tooltips and this file never drift. When a step adds a key, it updates that array **and** this file.
9. **Reduced motion** never disables a key; it only shortens the visual transition.

---

## 2. Player — exported file and editor "Apresentar" (F5)

| Key | Action | UI label (pt-BR) | Status | Notes |
|---|---|---|---|---|
| → · PageDown · Space · Enter · click on the right 18 % | Advance | Avançar | today | With F8 builds: reveals the next build group first; with F9: if a chapter card is showing, only skips the card. Decks without `anim.step` behave exactly as today. |
| ← · PageUp · Backspace · click on the left 18 % | Back | Voltar | today | Previous slide shown already built (F8). Same chapter-card rule. |
| Home / End | First / last slide | Primeiro / Último slide | today | |
| F | Full screen on/off | Tela cheia (F) | today | |
| Esc | Close the topmost layer, else leave | Fechar · Sair (Esc) | today | Leave = exit present mode (editor, `opts.onExit`) or leave edit mode (exported file, F11). See §3. |
| **G** | Índice (slide list) on/off | Índice de slides (G) | **S15** (shipped, `rt-150-nav.js`) | TMG behaviour. `.amp-pos` is a `<button data-a="index">`; its text stays `<b>01</b> / 07` (the ▾ is CSS). Grouped by chapter (`AMRT.sectionsOf`); ↑ ↓ Home End move focus, Tab cycles inside, Enter/click go, Esc closes, click outside closes. Focus returns to the counter only when it was opened from the focused counter (Tab+Enter); otherwise it is released so Space keeps advancing. Opening closes the Resumo. |
| **I** | "Sobre este slide" (resumo) on/off | Sobre este slide (I) | **S15** (shipped, `rt-150-nav.js`) | Bar button `[data-a=notes]`, first in the centre group (as in TMG). Text = player override (`localStorage['amPlayer.notes:'+deck.id]`) > `slide.notes` written in the editor > `AMRT.autoNotes` (tag "automático"). Editar → `plaintext-only`; Ctrl/⌘+Enter, blur or Editar again save; Esc cancels (footer says so while editing); "Restaurar original" drops the override; an override is dropped automatically when the editor's text changes. Rule 1 keeps Space/I/G typing. Follows navigation while open. Opening closes the Índice. |
| click on a rail segment (`.amp-rs`) | Jump to the first slide of that chapter | — | **S15** | Rail row above the bar, only with ≥ 2 chapters; per-chapter progress fill; `aria-current="step"`. Chapter cards and the wipe (F9 §3) are **not** shipped. |
| **Z** | Ampliar the element under the pointer, else the largest zoomable | Ampliar (Z) | **S5** (shipped) | ← → move between zoomables while open; Tab cycles ‹ › ✕; Esc, ✕ or a click on the backdrop close; every other key is swallowed. Also double-click on the element, the ⤢ hover button and the bar button “Ampliar” (hidden when the slide has nothing to amplify). Rules 4 and 5 of §1 are implemented since S5. |
| **P** (alias **K**) | Pause / resume effects | Pausar efeitos (P) / Retomar efeitos (P) | F8 | `aria-pressed` on the dock button. Advance also resumes. |
| **.** / **,** | Step effect time ±500 ms | Passo › / ‹ Passo | F8 | Pauses first if playing. |
| **R** | Restart the slide's effects | Reiniciar efeitos (R) | F8 | 260 ms navy fade, builds reset, unpauses. |
| **−** / **+** (also **=**) | Speed down / up through 0,25× 0,5× 1× 1,5× 2× | Velocidade (− / +) | F8 | Numpad − / + give the same `e.key`. |
| **0** | Speed back to 1× | Velocidade normal (0) | F8 | |
| **T** | Automatic tour on/off | Tour automático (T) | F8 | Any manual navigation pauses the tour ("Tour pausado — você assumiu"). |
| **B** | Glow layer on/off (deck-wide) | Brilho (B) | F8 | Moved from DTS "G". |
| **V** | Sweep now | Varrer agora (V) | F8 | |
| **D** | Depth (3D) layer on/off | Profundidade (D) | F8 | |
| **C** | Comments panel on/off | Comentários (C) | F11 | Exported file. Optional in the editor player (read-only). |
| **E** | Edit mode on/off | Editar (E) | F11 | **Only** when `opts.editable` (exported file). Ignored in the editor's present mode. |
| **?** | Presenter shortcuts overlay | Atalhos (?) | F8 | Lists this table's active keys from `AMRT.KEYS`. |
| Swipe > 60 px (touch) | Advance / back | — | F9 | `touchstart`/`touchend` pair, like TMG. |

Editor present mode only: **F5** (start from the beginning) and **Shift+F5** (from the current slide) are handled by the editor before the player sees them (editor.js keydown). The player never binds F-keys other than F.

Localizar e substituir (S27b): **Ctrl/⌘+F** or **Ctrl+H** open the floating panel (also Editar › Localizar e substituir…); inside it Enter = next, Shift+Enter = previous, Esc = close; the editor's own Esc closes it too. Lists while editing text: **Tab** / **Shift+Tab** on a list item change its level.

Organizar (S27a, editor, nothing selected in a field): **Ctrl/⌘+G** group the selection, **Ctrl+Shift+G** ungroup, **Ctrl+Shift+L** lock/unlock, **Ctrl+Alt+C** copy format, **Ctrl+Alt+V** paste format (Ctrl+Shift+C/V are left to the browser's DevTools). A click on a group member selects the group; a second click on a member selects only it. Locked elements ignore drag, arrows, resize, rotate, flip and Delete.

Slides institucionais (S34/S34b, editor): no new keys — ribbon button **Institucional A&M**, “+ Novo slide” › Inserir os 5 slides institucionais, right-click on a thumbnail › Inserir slides institucionais A&M, Slide › Inserir slides institucionais A&M (or Inserir bloco pronto ▸), Inserir › Marca A&M ▸, the panel button, or cover › Projetos prontos › 6; one Ctrl+Z removes the block; the import report's “Usar os modelos oficiais” is one Ctrl+Z too.

Slides de uma planilha (S33, editor): no new keys — Slide › Gerar slides de uma planilha (CSV)…; inside the box Esc closes, Tab cycles, Enter in the paste area adds a line (never generates), the Gerar button generates.

Conectores presos (S32, editor): drag a line end near a shape to bind it (side midpoint or automatic); **Alt** while dragging = do not bind; **Shift** still snaps the angle; moving the line alone unbinds it. No new keys.

Personagens A&M (S35): no new keys. Editor: Inserir › Personagens ▸ or ribbon Marca ▾ › Personagens A&M (10 presets + Balão de fala), presets as the “Personagem” chips of the panel, double click on the bubble text edits it in place, Ctrl+Z undoes any part change, dragging the aimed element re-aims the arm. Player: the mouse moves the eyes, a click on the character plays its reaction (expression, second line, movement, glow on the aimed element) and a second click reverts; the choice buttons in the bubble change the expression and jump to the slide they name (a mouse click leaves no focus on them, so Space/Enter keep advancing; Tab still reaches them and Enter/Space activate the focused one); clicks on the drawing never advance the slide (`.am-ia`), clicks on the empty part of its box do; ← → Space keep navigating.

Workshop (S31, in the player): inside a post-it's text the player keys are off; **Enter/Space** on a focused +/−, Votar, colour dot, × or timer button activates it; dragging a note uses the pointer only (no keyboard move).

Formulário (S30, in the player): inside an answer box the player keys are off (typing, Space, arrows); **Enter** in a short answer moves to the next field, **Shift+Enter** / Enter in a long answer breaks the line; **Enter/Space** on a focused option, rating or button activates it (never navigates); Esc still closes layers.

Kit de marca (S29): no new keys — Arquivo › **Kit de marca…** or the **Kit de marca…** button in the slide panel (Fundo) open the box; inside it **Esc** closes (with “Mais cores…” open, Esc closes only the pop), **Tab** cycles, **Enter** in the codes field adds the colours and in the name field saves it (never submits/closes); every action is one **Ctrl+Z** step once the box is closed.

Text editing (S26, inside the contenteditable): **Ctrl/⌘+B / I / U** bold, italic, underline; **Ctrl+Shift+8** bulleted list, **Ctrl+Shift+7** numbered list; Esc ends the edit. The floating bar `#txBar` adds strike, A−/A+, colour, marker, alignment and clear. All other keys inside the text stay with the browser (native undo included).

Importar PowerPoint ou PDF (S24): no key; Arquivo › Importar… or drop a `.pptx`/`.pdf` on the slide. Inside the import dialog the same rules as the export dialogs apply (Esc cancels/closes, Tab stays inside, Ctrl+S/O/D/P/Z/Y and F1/F5 are swallowed).

Editor only (S21b): **Ctrl/⌘+P** opens “Salvar como PDF” (never the browser's print of the editor UI; the browser menu's Imprimir prints the slides via `beforeprint` → `AMExport.preparePrint`). Ctrl+S and Ctrl+P also work while the ▾ “Salvar como…” menu is open (the menu closes first). Inside the export dialogs Ctrl+S/O/D/P/Z/Y and F1/F5 are swallowed (they never reach the editor or the browser).

Hidden slides (S21, `slide.hidden`): F5, Shift+F5, ←/→, Home/End, the índice (G), the rail and the exported file all skip them (the player only receives the visible slides). Shift+F5 on a hidden slide starts at the next visible one (else the previous); if every slide is hidden, all are shown. No key was added for “Ocultar slide” / “Redefinir slide” (menus and the slide panel only).

---

## 3. Esc priority (topmost first)

1. Ampliar overlay (F5)
2. Comments panel (F11) — Esc inside its textarea first blurs the field (rule 1), a second Esc closes the panel
3. Índice (F9)
4. Resumo do slide (F10)
5. Effects popover `.amp-fxp` (F8)
6. Shortcuts overlay `?` (F8)
7. Chapter card (F9): skip it
8. Edit mode (exported file, F11): leave edit mode (pending text edits are committed)
9. Nothing open: exit present mode (editor only, `opts.onExit`)

Invariant pinned by test-core: with nothing open, **Esc exits present mode**. No chapter card on the initial `go(start)`, or Shift+F5 → Esc → `#bHome` breaks (ARCH §0.11).

---

## 4. Layer-local keys (while a layer is open)

| Layer | Keys | Behaviour |
|---|---|---|
| Índice (F9) | ↑ ↓ · Home End · Enter · Esc | Move focus in the list; Enter opens the slide and closes the índice. Other letters keep their global meaning (G closes). |
| Ampliar (F5) | ← → · Esc | Previous / next zoomable element of the slide; Esc closes. Advance keys do not change slide while open. |
| Comments (F11) | Ctrl/⌘+Enter · Esc | Add the comment typed in "Novo comentário"; Esc blurs, then closes. |
| Edit mode in the exported file (F11) | Arrows / Shift+arrows · Ctrl/⌘+S · Ctrl/⌘+Z · Ctrl/⌘+Shift+Z · Esc | Arrows nudge the selected element 1 px / 10 px (navigate when nothing is selected); Salvar cópia; Desfazer; Refazer; leave edit mode. Double-click edits text (rule 1 then applies). |
| Shortcuts overlay (F8) | Esc · ? | Close. |
| Editor “Mais cores…” popover (S19, `ed-colors.js`) | ← → ↑ ↓ · Home End · Enter/Space · Tab/Shift+Tab · Esc · Enter in the hex field | Arrows move between colour swatches (↑/↓ go to the nearest swatch in the row above/below, across sections); Enter/Space applies the focused colour; Tab cycles inside the popover; Esc closes and returns focus to the “Mais cores…” button; Enter in “Personalizada” applies a valid #RRGGBB (invalid = red outline, nothing applied). Every other key pressed inside the popover stops there (arrows never nudge the element, Delete never deletes). Exceptions: F5 / F1 / Ctrl+S / Ctrl+O close the popover (preview cancelled) and do what they do in the editor (present, help, save, open), never reaching the browser; Ctrl+P / Ctrl+D / Ctrl+A (A outside the hex field) are swallowed. Esc after a native-picker preview reverts it (no undo step). |
| Editor “Salvar como…” menu (S22, ▾ `#bSaveMore` next to Salvar) | Enter/Space or ↓ on ▾ · ↑ ↓ · Home End · Enter · Esc · Tab | Opens the app-style menu (`openX`, same keyboard as Arquivo) with the first item highlighted; Enter runs the item; Esc/Tab close and return focus to ▾. A plain click on **Salvar** (and Ctrl+S) still downloads the .html. |
| Editor export dialog “Salvar como PDF” / “PDF pelo navegador” (S22, `ed-40-export.js`, own dialog, not `#modal`) | Tab/Shift+Tab · Space · ↑ ↓ (radio groups) · Enter · Esc | Tab cycles inside the dialog (focus trap); Enter in a field or on **Exportar PDF** starts the export; **Esc** closes when idle (focus back to the opener: ▾, or where it was for Arquivo › Salvar como PDF…) and **cancels** while a PDF is being generated (the dialog stays open). Every other key stops at the dialog (Delete, arrows, Ctrl+Z never reach the slide); F1 / F5 / Ctrl+S/O/D/P (outside fields) are swallowed. |
| Editor export dialog “Salvar como PowerPoint” (S23, `ed-41-pptx.js`, `#xkDlg`, own dialog, not `#modal`) | Tab/Shift+Tab · Space · ↑ ↓ (radio groups) · Enter · Esc | Same keyboard as the PDF dialog: focus trap; Enter on **Exportar PowerPoint** (or in a field) starts; **Esc** closes when idle (focus back to ▾ or the previous element) and **cancels** while the .pptx is being generated (the dialog stays open). Other keys stop at the dialog. No new shortcuts. |

---

## 5. Editor (today — source of truth is `HK` in editor.js, shown by F1 and in the cover manual)

| Keys | Action |
|---|---|
| Ctrl+C / Ctrl+X / Ctrl+V | Copiar / recortar / colar elementos, or slides with the thumbnail focused |
| Ctrl+D | Duplicar (element, or slide with the thumbnail focused) |
| Ctrl+A | Selecionar tudo no slide |
| Delete / Backspace | Apagar seleção (or the slide with the thumbnail focused) |
| Ctrl+Z · Ctrl+Shift+Z / Ctrl+Y | Desfazer · Refazer |
| Ctrl+O · Ctrl+S | Abrir apresentação · Salvar apresentação |
| Arrows / Shift+arrows | Move the selection 1 px / 10 px; with nothing selected ↑ ↓ PageUp PageDown change slide (← → too with the thumbnail focused) |
| Alt+← / Alt+→ (Alt+Shift: 1°) | Girar a seleção 15° anti-horário / horário (**S17**). Canvas zone with a selection, never while typing; AltGr (`getModifierState('AltGraph')`) never rotates. Lines turn their endpoints around the midpoint. One undo step per press; `preventDefault` also stops the browser's Alt+← “back”. |
| Enter · typing a character | Edit the selected text/shape (typing starts the edit with that character; AltGr counts) |
| Shift+F10 · ContextMenu key | Menu de opções (context menu) |
| Esc | Leave text editing; close menus and the Biblioteca; clear the selection |
| F5 · Shift+F5 | Apresentar do início · do slide atual |
| F1 · ? | Atalhos de teclado |

**Vitrine de efeitos (F1, shipped in S1; not in `HK` on purpose, so the F1 modal and the cover manual keep their size):**

| Keys | Where | Action |
|---|---|---|
| Arrows | focus on a box (`.gx-try`) | Move focus across the grid (columns measured from the layout); never nudges the slide |
| Enter · Space | focus on a box | Open the Provador (native button) |
| ← → | Provador open (focus inside it) | Previous / next effect in the current filter (same as the ‹ › buttons) |
| Space · Enter | Provador open, focus not on a button | Repetir (replay the preview); on a button they stay native |
| ? | Provador open, focus not on a button | Atalhos de teclado |
| Delete · Backspace · letters · ↑ ↓ · PgUp/PgDn · Home/End | Provador open, focus not on a button | Kept in the Provador (↑ ↓ scroll it); they never reach the selected element behind it |
| Esc | Provador open | Descartar: close the Provador only (the drawer stays open and the selection is kept); handled by the Provador's own listener and, with focus elsewhere, by the editor's Esc branch (`gxIsOpen()`) |

"Focus inside the Provador" includes a click on a non-focusable part of it: `#gxProv` has `tabindex="-1"`, so the click focuses the region. A click elsewhere in the drawer (header text) leaves focus on `body`; a capture `pointerdown` sets `gx.pin`, and the editor's keydown routes those keys to `gxKeys(e)` too (QA S1 round 1). Ctrl/⌘ shortcuts (undo, save…) keep working; a click on the canvas clears `gx.pin`, so arrows nudge the selection again.

**Seletor de ícones animados (F3, shipped in S3; popover `#icMenu`, not `#modal`; also not in `HK`).** The editor keydown calls `icKey(e)` before any other shortcut while it is open, so nothing reaches the slide behind it:

| Keys | Where | Action |
|---|---|---|
| any letter · Backspace | focus on a tile or a chip | Focus goes to the search and the character is typed there |
| ↓ | search | Go to the grid (the highlighted tile: the current icon of the selection, else the first result) |
| ← → | tile | Previous / next tile; on a chip: previous / next chip |
| ↑ ↓ · PgUp / PgDn | tile | Row above / below, nearest column (the theme headings break the rows); ↑ on the first row returns to the search |
| Home / End | tile | First / last tile |
| Enter · Space | tile | Choose: swap the selected icon (same kind) or insert a new one in the centre |
| Enter | search | Choose the highlighted tile (the first result while typing; the footer names it) |
| Shift+Enter · Shift+click | tile or search | Always insert a new icon (never swap) |
| Tab · Shift+Tab | anywhere in the picker | Cycle search → theme chips → grid (focus stays in the picker) |
| Esc | anywhere in the picker | Close it and return focus to the opener (“Ícones” button or the panel button) |
| Ctrl/⌘ combos | search | Native text editing (Ctrl+A, Ctrl+C…); elsewhere the picker closes and the editor shortcut runs (Ctrl+S saves) |

The player gives icons no new keys: “Ao clicar” icons and the click-toggle transformation stop the click's propagation, so a click on them (even inside the 18 % side zones) never changes the slide.

**Formas e linhas (F4, shipped in S4; not in `HK`).** Ribbon “Formas ▾” (`#mShape.gmenu`, 6-column gallery): ↓ from the opener focuses the first tile, then ↓ ↑ go to the row below/above (nearest column, across group headings), ← → previous/next tile, Enter/Space insert, Esc closes. Inserir › “Forma ▸” is a two-column menu (`.xmenu.xcols`): ↓ ↑ stay in the column, → ← move to the neighbouring column (← in the left column closes the submenu, as before), Enter inserts. Elbow lines: the bend is also reachable from the keyboard through the “Dobra do cotovelo” slider in the panel (arrow keys, native range).

**Painel de slides — largura e recolher (S18; no new global shortcut, so not in `HK`).** The divider on the right edge of the thumbnails panel (`#sideSplit`, `role="separator"`, “Largura do painel de slides”) is a Tab stop; with focus on it:

| Keys | Action |
|---|---|
| ← / → | Narrower / wider by 16 px |
| Shift + ← / → | Narrower / wider by 64 px |
| Home / End | Minimum (132 px) / maximum (min(440, window − 824) px) |
| Enter · Space | Back to the default width (196 px) — same as a double-click on the divider |
| Ctrl/⌘ + mouse wheel over the panel | Wider (wheel up) / narrower (wheel down), instead of the browser zoom: 16 px per wheel notch (deltaY 100), proportional to smaller deltas (a light trackpad pinch moves a few px), never more than 16 px per event |
| Esc while dragging the divider | Cancels the drag: back to the width at the start, nothing saved |

The divider's keydown calls `stopPropagation`, so these keys never reach the slide (it also matches `onControl`). The collapse/expand buttons « (`#sideCollapse`, “Recolher painel de slides”) and » (`#sideExpand`, “Mostrar painel de slides”) are plain buttons (Enter/Space); toggling from the keyboard moves focus to the other button; clicking them with the mouse leaves no focus on the button (↓ / PageDown change slide right away), and collapsing while the thumbnails had the keyboard zone hands it to the canvas (Delete / Ctrl+D / Shift+F10 never act on a hidden thumbnail). Menu **Slide › Ocultar / Mostrar painel de slides** does the same. The “+” of the collapsed strip opened with Enter/Space puts focus on the first layout; Esc closes the menu and returns focus to “+”. With the panel wide enough for **2 columns** (≥ 380 px) and the thumbnails focused, ↑ ↓ move one row (2 slides) — ↑ on the first row and ↓ on the last row stay put, ↓ goes to the last slide only when it sits in the row below; ← → stay previous / next.

Editor rules that new features must respect: the modal (`#modal`) captures the whole keyboard (Enter = confirm, so **no forms in `#modal`**, ARCH §0.15); focused controls keep Enter/Space/arrows/Delete (`onControl`); fields in the props panel and `#title` are "typing" targets.
New editor panels with text fields (F9 "Capítulo", F10 "Resumo do slide") are covered by the existing typing guard. Add any new editor shortcut to `HK`.

---

## 6. Cover (today)

| Keys | View | Action |
|---|---|---|
| 1 – 6 | home | The six options (Nova, Projetos prontos, Retomar, Abrir, Almoxarifado, Manual) |
| 1 – 5 | Projetos prontos | Choose a template |
| Arrows | home / Projetos | Move focus (3-column grid on home) |
| Esc · Backspace | non-home views | Back (Esc on home closes the cover when opened from the editor) |
| F1 · ? | any | Manual da obra |
| F5 · Shift+F5 | any | Present the open work (when the cover was opened from the editor) |
| Ctrl+S | any | Save the open work |
| Tab | any | Focus trap inside the cover |

**F2 "Minhas obras" view (cover view `hist`, shipped in S2)**: the top-right "Minhas obras" button is not a `.cv-opt` (the 1–6 keys stay as they are).

| Keys | Where | Action |
|---|---|---|
| M | home | Open Minhas obras |
| ← → ↑ ↓ · Home / End | hist, focus on a card or its buttons | Move between cards (geometric up/down, like home) |
| Enter · Space | focus on a card preview / "Abrir e editar" | Abrir e editar (native button) |
| F2 (or double-click the name) | hist, focus in a card | Renomear in place: Enter saves, Esc cancels, leaving the field saves |
| Delete | hist, focus in a card | Excluir (asks first; Esc cancels and returns focus) |
| Ctrl/⌘+D | hist, focus in a card | Duplicar |
| / · Ctrl/⌘+F | hist | Focus the search field |
| Enter · ↓ | in the search field | Go to the first result |
| Esc | in the search field | Clear it; when already empty, back |
| Esc · Backspace | hist (not typing) | Back (to the editor when opened from Arquivo › Minhas obras…) |

Typing wins in the cover's fields (search, rename): the cover key handler only handles Esc, Enter and Tab there (plus Ctrl/⌘+S/O/P/D prevented); digits, `?`, Backspace and Ctrl+A/C/V/X/Z work natively.

---

## 7. Letters: who owns what

| Letter | Player owner | Do not reuse for |
|---|---|---|
| B | Brilho (F8) | |
| C | Comentários (F11) | |
| D | Profundidade (F8) | |
| E | Editar (F11, exported file only) | |
| F | Tela cheia | |
| G | Índice (F9) | Glow (moved to B) |
| I | Resumo do slide (F10) | |
| K | Pausar (alias of P, F8) | |
| P | Pausar / Retomar (F8) | |
| R | Reiniciar efeitos (F8) | |
| T | Tour automático (F8) | |
| V | Varrer agora (F8) | |
| Z | Ampliar (F5) | |
| Free | A H J L M N O Q S U W X Y | N and S are better left free (N reads as "notas", S as "salvar"). |

Symbols: `.` `,` (passo), `-` `+` `=` `0` (velocidade), `?` (atalhos). Digits 1–9 are free in the player (candidate: jump to chapter N, F9 optional).

---

## 8. Implementation skeleton for `key()` (runtime.js, player)

```js
function key(e) {
  var kt = e.target, k = e.key;
  if (kt && (/input|textarea|select/i.test(kt.tagName) || kt.isContentEditable)) return;            /* F0 */
  if ((e.ctrlKey || e.metaKey || e.altKey) && !(e.getModifierState && e.getModifierState('AltGraph'))) return; /* F0 */
  if (zoomOpen) { /* §4 Ampliar */ return; }
  if (idxOpen && /^(ArrowUp|ArrowDown|Home|End|Enter)$/.test(k)) { /* §4 Índice */ return; }
  if (k === 'Escape') { /* §3, topmost layer first; finally opts.onExit */ return; }
  var onBtn = kt && kt.closest && kt.closest('button,[role=button],a[href]');
  if ((k === 'Enter' || k === ' ') && onBtn) return;                                                  /* rule 4 */
  switch (k.length === 1 ? k.toLowerCase() : k) { /* G I Z P K . , R - + = 0 T B V D C E ? F, then navigation */ }
}
```
Each step that owns a key adds its `case` and its `AMRT.KEYS` row. Keep `key()` the only player keydown listener (the edit layer of F11 is the one exception, for Ctrl/⌘ combos).

---

## 9. Acceptance checks (add to the step's `test-sNN-*.js`)

- Space and letters typed into a `contentEditable`, `input` and `textarea` inside the player type and do not navigate or toggle anything (test-s00 S00-24/25 cover Space/arrows/Home).
- Ctrl/Alt + arrow does not navigate (S00-26).
- Each new letter toggles its layer and its button's `aria-pressed` / `aria-expanded`; pressing it again closes it.
- Esc closes the topmost layer only (open two layers, press Esc twice).
- After a mouse click on any bar/dock button, Space still advances.
- With nothing open, Esc exits present mode in the editor; Shift+F5 → Esc → `#bHome` works (test-core).
- The `?` overlay lists exactly the keys active in that context (E only in the exported file).
