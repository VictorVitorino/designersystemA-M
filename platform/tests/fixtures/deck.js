/* Decks de teste no formato do editor (AMStudio.deck): {v:1, app, id, title, slides:[{id,bg,tr,els:[…]}], brand, comments}. */
import { sha256Hex } from '../../src/lib/canonical.js';

export const refOf = (seed) => 'asset:sha256:' + sha256Hex(String(seed));

const text = (id, html, over = {}) => ({ id, type: 'text', x: 54, y: 62, w: 1030, h: 46, html, size: 32, weight: 400, color: '#002A46', font: 'Roboto', anim: { in: 'fade', delay: 150 }, ...over });
const fx = (id, kind, data) => ({ id, type: 'fx', kind, x: 100, y: 200, w: 600, h: 300, data, anim: { in: 'rise', delay: 0, dur: 700, loop: 'none', hover: 'none' } });

/** Deck realista: texto rico, formas, linhas ligadas, imagem externalizada, componentes (fx), notas, comentários e kit de marca. */
export function sampleDeck({ slides = 3, title = 'Plano 2026 — Alvarez & Marsal', images = [] } = {}) {
  const out = [];
  for (let i = 0; i < slides; i++) {
    const els = [
      text(`t${i}`, `Título do slide ${i + 1}`),
      text(`b${i}`, '<b>Receita</b> cresce <span style="color:#F78C16">+12%</span> ao ano<br>• meta → 2027 ⇒ margem 35%'),
      { id: `s${i}`, type: 'shape', shape: 'round', x: 54, y: 300, w: 300, h: 160, fill: '#EBEEF1', stroke: '#002A46', strokeW: 1, html: 'Caixa' },
      { id: `l${i}`, type: 'line', x1: 354, y1: 380, x2: 600, y2: 380, a1: { id: `s${i}`, s: 'e' }, stroke: '#002A46', strokeW: 2, headE: 'arrow' },
      fx(`f${i}`, 'headline', { text: 'Resultado', hl: 'Resultado', size: 72, color: '#FFFFFF', font: 'Roboto', weight: 300 }),
      fx(`g${i}`, 'smart', { items: [{ t: 'Diagnóstico', lv: 0 }, { t: 'Plano', lv: 0 }, { t: 'Execução', lv: 1 }] }),
    ];
    for (const ref of images) els.push({ id: `i${i}-${ref.slice(-6)}`, type: 'image', x: 700, y: 120, w: 400, h: 300, src: ref });
    out.push({ id: `sl${i}`, bg: '#FFFFFF', tr: 'fade', els, notes: 'Notas do apresentador: falar do script de coleta e do atributo onclick (só prosa).', base: { bg: '#FFFFFF', els: {} } });
  }
  return { v: 1, app: 'AM Studio', id: 'deck-demo-1', title, slides: out, nav: { chapters: true }, num: { on: true, pos: 'br' }, brand: { name: 'A&M', colors: ['#002A46', '#F78C16'], font: 'Roboto' },
    comments: [{ id: 'c1', text: 'Revisar a margem do slide 2 (ver planilha).', ts: 1_700_000_000_000, author: 'Ana', slide: 'sl1', x: 120, y: 90 }], created: 1_700_000_000_000, updated: 1_700_000_100_000 };
}
