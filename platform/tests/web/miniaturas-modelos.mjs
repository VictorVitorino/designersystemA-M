/* miniaturas-modelos.mjs — gera web/assets/modelos/modelo-1..6.png: o 1º slide de cada "Projeto pronto" da capa do editor autônomo
   publicado na raiz (AM-Studio-Editor.html = o build atual de studio/, que o build em nuvem segue; original/ é só a cópia do upload S34b),
   renderizado pelo próprio runtime (AMRT.renderSlide de AMCover.buildTemplate(i)). O acervo mostra estas imagens no diálogo
   "Nova a partir de projeto pronto" (a plataforma não carrega o runtime do editor). Rode de novo se os projetos prontos mudarem:
     /opt/node22/bin/node platform/tests/web/miniaturas-modelos.mjs
   Usa as fontes de fonts2/ (as mesmas que os testes servem no lugar do Google Fonts). */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NODE_PATH = process.env.NODE_PATH || '/opt/node22/lib/node_modules';
const require = createRequire(import.meta.url);
require('module').Module._initPaths();
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const FONTS = path.join(REPO, 'fonts2');
const EDITOR_PUBLICADO = path.join(REPO, 'AM-Studio-Editor.html');
const OUT = path.resolve(HERE, '../../web/assets/modelos');
const W = 640, H = 360;

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: fs.readFileSync(path.join(FONTS, 'gf.css'), 'utf8') }));
  await ctx.route('https://fonts.gstatic.com/**', (r) => { const f = path.join(FONTS, path.basename(new URL(r.request().url()).pathname)); return fs.existsSync(f) ? r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(f) }) : r.abort(); });
  const page = await ctx.newPage();
  await page.goto(`${pathToFileURL(EDITOR_PUBLICADO).href}?nocover`);
  await page.waitForFunction(() => window.AMCover && window.AMRT && window.AMCover.templates.length === 6);
  await page.evaluate(() => document.fonts.ready);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(({ i, W, H }) => {
      document.getElementById('__pv')?.remove();
      const box = document.createElement('div'); box.id = '__pv';
      Object.assign(box.style, { position: 'fixed', left: '0', top: '0', width: `${W}px`, height: `${H}px`, zIndex: '2147483647', background: '#fff', overflow: 'hidden', containerType: 'size' });
      const s = window.AMRT.renderSlide(window.AMCover.buildTemplate(i).slides[0], { play: false });
      Object.assign(s.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
      box.appendChild(s); document.body.appendChild(box);
    }, { i, W, H });
    await page.waitForTimeout(700);
    await page.locator('#__pv').screenshot({ path: path.join(OUT, `modelo-${i + 1}.png`) });
    console.log(`modelo-${i + 1}.png`);
  }
} finally { await browser.close(); }
