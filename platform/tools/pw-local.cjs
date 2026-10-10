/* Uso local, quando platform/node_modules traz o Playwright do CI (package.json) e a máquina só tem os navegadores do Playwright global
   (/opt/node22/lib/node_modules, os mesmos das baterias de studio/): NODE_OPTIONS="--require ./tools/pw-local.cjs" node tests/cloud/preservacao.test.js
   (vale para os filhos, ex.: o qa-gate.sh da cópia) e npm run test:parity:quick. Redireciona só o require('playwright'); no CI não se usa. */
const M = require('module'), orig = M._resolveFilename, GLOBAL = '/opt/node22/lib/node_modules/playwright';
M._resolveFilename = function (req, ...a) { return orig.call(this, req === 'playwright' && require('fs').existsSync(GLOBAL) ? GLOBAL : req, ...a); };
