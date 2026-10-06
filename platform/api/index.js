/* Entrada da Vercel (Node runtime): todas as rotas /api/* caem aqui (vercel.json). O HTML/JS/CSS estáticos são servidos pela CDN. */
import { handle } from 'hono/vercel';
import { loadConfig } from '../src/config.js';
import { buildDeps } from '../src/deps.js';
import { createApp } from '../src/app.js';

let app;
function get() { if (!app) app = createApp(buildDeps(loadConfig(process.env))); return app; }
export const config = { runtime: 'nodejs' };
const h = (req) => handle(get())(req);
export const GET = h, POST = h, PUT = h, PATCH = h, DELETE = h, OPTIONS = h, HEAD = h;
export default h;
