/* Leitura de corpo JSON com limite e validação zod. Mensagens em pt-BR; nunca ecoa o valor recebido. */
import { z } from 'zod';
import { E } from '../lib/errors.js';

export async function readJson(c, schema, { maxBytes = 16 * 1024 } = {}) {
  const len = Number(c.req.header('content-length') || 0);
  if (len > maxBytes) throw E.tooLarge();
  const text = await c.req.text();
  if (text.length > maxBytes) throw E.tooLarge();
  let data;
  try { data = text.length ? JSON.parse(text) : {}; } catch { throw E.badRequest('JSON inválido.'); }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw E.badRequest('JSON inválido.');
  return schema.parse(data);
}

const req = { required_error: 'Campo obrigatório.', invalid_type_error: 'Valor inválido.' };
export const emailField = z.string(req).trim().toLowerCase().min(3, 'E-mail inválido.').max(254, 'E-mail muito longo.').email('E-mail inválido.');
export const uuidField = z.string(req).uuid('Identificador inválido.');
/** Nome de exibição: sem caracteres de controle nem < > (o front escapa, mas barramos aqui também: defesa em profundidade contra XSS). */
export const displayNameField = z.string(req).trim().min(1, 'Informe o nome.').max(120, 'Nome muito longo.')
  .refine((s) => !/[\u0000-\u001f\u007f<>]/.test(s), 'Nome contém caracteres não permitidos.');
export { z };
