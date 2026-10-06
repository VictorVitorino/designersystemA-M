/* IP do cliente para limite de taxa e auditoria.
   Por que não confiar cegamente em cabeçalhos: quem fala direto com o servidor poderia forjar X-Forwarded-For e escapar do limite de taxa.
   Por isso só lemos cabeçalhos quando TRUST_PROXY está ligado (padrão: atrás da Vercel/Cloudflare, que SOBRESCREVEM o cabeçalho).
   Usamos a entrada MAIS À DIREITA do X-Forwarded-For: é a que o nosso proxy acrescentou (as da esquerda vêm do cliente e podem ser inventadas). */
import { isIP } from 'node:net';

/** Valida e normaliza (minúsculas, sem prefixo ::ffff:). Devolve null se não for um IP válido — o valor vai para uma coluna `inet`. */
export function normalizeIp(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (s.startsWith('::ffff:') && isIP(s.slice(7)) === 4) s = s.slice(7);
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  return isIP(s) ? s : null;
}

/** @param {import('hono').Context} c @param {{trustProxy?:boolean}} config */
export function clientIp(c, config) {
  if (config?.trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      const ip = normalizeIp(parts[parts.length - 1]);
      if (ip) return ip;
    }
    const real = normalizeIp(c.req.header('x-real-ip'));
    if (real) return real;
  }
  return normalizeIp(c.env?.incoming?.socket?.remoteAddress);
}
