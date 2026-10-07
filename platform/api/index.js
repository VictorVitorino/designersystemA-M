/* Entrada da Vercel (Node runtime): todas as rotas /api/* caem aqui (vercel.json). O HTML/JS/CSS estáticos são servidos pela CDN. */
import { handle } from 'hono/vercel';
import { loadConfig } from '../src/config.js';
import { buildDeps } from '../src/deps.js';
import { createApp } from '../src/app.js';

let app;
function get() { if (!app) app = createApp(buildDeps(loadConfig(process.env))); return app; }
export const config = { runtime: 'nodejs' };
const h = (req) => handle(get())(req);
/* SÓ exportações nomeadas por método. NÃO exporte `default`: o carregador Node da Vercel (@vercel/node, compileUserCode/unwrapDefaults)
   desembrulha `.default` ANTES de procurar GET/POST/fetch; com `export default h` o módulo vira uma função comum, é chamado como
   (req, res) do Node, devolve um Response que ninguém escreve e TODA rota /api fica sem resposta até o tempo máximo (504).
   tests/unit/vercel-entry.test.js reproduz essa detecção. */
export const GET = h, POST = h, PUT = h, PATCH = h, DELETE = h, OPTIONS = h, HEAD = h;
