/* Gera tests/fixtures/real-decks.json a partir do EDITOR REAL (studio/AM-Studio-Editor.html, somente leitura) num Chromium headless:
     · os 6 "projetos prontos" da capa (AMCover.buildTemplate);
     · um deck "kitchen sink": 1 slide por componente (49 tipos, até 3 variantes) e por layout (18), já passado por safeDeck.
   As imagens `data:` são trocadas por `asset:sha256:<sha256 do data URI>` — o que o cliente da nuvem faz antes de salvar —, mantendo o
   arquivo pequeno. Uso (opcional; o JSON gerado já está versionado):   node tests/fixtures/extract-real-decks.mjs
   Requer Playwright + Chromium (PLAYWRIGHT_MODULE_DIR aponta para a pasta que contém node_modules/playwright; padrão: global). */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const editor = path.resolve(here, '../../../studio/AM-Studio-Editor.html');
const require = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node22/lib/node_modules') + '/');
const { chromium } = require('playwright');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(pathToFileURL(editor).href);
  await page.waitForFunction(() => window.AMStudio && window.AMCover && window.AMRT, null, { timeout: 30000 });
  const raw = await page.evaluate(() => {
    const S = window.AMStudio, RT = window.AMRT;
    const templates = window.AMCover.templates.map((_, i) => window.AMCover.buildTemplate(i));
    const slides = [];
    for (const k of Object.keys(RT.FX)) {
      const F = RT.FX[k], variants = F.variants && F.variants.length ? F.variants.map((v) => v[0]) : [null];
      for (const v of variants.slice(0, 3)) { const el = S.mk.fx(k); if (v) el.variant = v; slides.push({ id: S.uid(), bg: '#FFFFFF', tr: 'fade', els: [el] }); }
    }
    for (const l of Object.keys(S.LAYOUTS)) slides.push(S.mk.slide(l));
    const kitchenSink = S.safeDeck({ v: 1, app: 'AM Studio', id: 'kitchen-sink', title: 'Todos os componentes e layouts', slides });
    return { names: window.AMCover.templates, templates, kitchenSink };
  });
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const externalize = (d) => JSON.parse(JSON.stringify(d).replace(/data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+/g, (m) => 'asset:sha256:' + sha(m)));
  const out = { note: 'Gerado por extract-real-decks.mjs a partir de studio/AM-Studio-Editor.html; imagens externalizadas como asset:sha256:<hash>.', names: raw.names, templates: raw.templates.map(externalize), kitchenSink: externalize(raw.kitchenSink) };
  writeFileSync(path.join(here, 'real-decks.json'), JSON.stringify(out));
  console.log('ok:', out.templates.length, 'projetos +', out.kitchenSink.slides.length, 'slides do kitchen sink');
} finally { await browser.close(); }
