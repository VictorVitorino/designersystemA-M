/* Validação de uploads por CONTEÚDO (docs/API.md §5). O nome do arquivo e o Content-Type do cliente são ignorados: o tipo sai dos
   "magic bytes" e é conferido por decodificação/estrutura. Por que tão rígido: o arquivo é guardado como veio (endereçado pelo
   SHA-256 dos bytes) e servido a todos os usuários; qualquer disfarce (SVG/HTML como .png, GIF/JPEG "polyglot", ZIP bomb,
   PPTX com macro) precisa morrer aqui, antes de tocar o armazenamento.
   Erros: 413 (grande demais), 415 (tipo não aceito), 422 (arquivo aceito em tese, mas corrompido/perigoso) com details.reasons[]. */
import sharp from 'sharp';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { HttpError, E } from './errors.js';

const KiB = 1024, MiB = 1024 * KiB, GiB = 1024 * MiB;
export const LIMITS = Object.freeze({
  kindBytes: { image: 25 * MiB, thumb: 512 * KiB, attachment: 100 * MiB },
  csvBytes: 10 * MiB, pdfBytes: 100 * MiB, pptxBytes: 100 * MiB,
  maxDimension: 12000, maxPixels: 100_000_000, maxFrames: 500, maxAnimatedPixels: 1_000_000_000,
  zipMaxEntries: 20000, zipMaxUncompressed: GiB, zipMaxRatio: 200, zipMinBytesForRatio: MiB, zipMaxNameLen: 512,
});
export const MIME = Object.freeze({
  png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', csv: 'text/csv',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});
// O que cada "kind" aceita. Anexos NÃO aceitam imagem e imagens NÃO aceitam documento: o kind declara a intenção do upload.
const KIND_TYPES = { image: ['png', 'jpeg', 'webp', 'gif'], thumb: ['png', 'jpeg', 'webp'], attachment: ['pdf', 'pptx', 'csv'] };

const reject = (reason, message) => new HttpError(422, 'rejected_content', message, { reasons: [reason] });
const unsupported = (reason, message) => new HttpError(415, 'unsupported_media', message, { reasons: [reason] });

/* ───────────── detecção por magic bytes ───────────── */

const startsWith = (b, sig, off = 0) => b.length >= off + sig.length && sig.every((x, i) => b[off + i] === x);
const ascii = (b, off, n) => b.toString('latin1', off, off + n);

/** @returns {{type:string}|{markup:'svg'|'html'|'xml'}|{binary:string}|{text:true}} */
function sniff(b) {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'png' };
  if (startsWith(b, [0xff, 0xd8, 0xff])) return { type: 'jpeg' };
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { type: 'gif' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { type: 'webp' };
  if (ascii(b, 0, 5) === '%PDF-') return { type: 'pdf' };
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return { type: 'zip' };
  if (startsWith(b, [0x50, 0x4b, 0x05, 0x06]) || startsWith(b, [0x50, 0x4b, 0x07, 0x08])) return { binary: 'zip' }; // zip vazio / segmentado
  if (ascii(b, 0, 2) === 'MZ') return { binary: 'executavel' };
  if (startsWith(b, [0x7f, 0x45, 0x4c, 0x46])) return { binary: 'executavel' };
  if (startsWith(b, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(b, [0xfe, 0xed, 0xfa, 0xcf]) || startsWith(b, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xcf, 0xfa, 0xed, 0xfe]) || startsWith(b, [0xca, 0xfe, 0xba, 0xbe])) return { binary: 'executavel' };
  if (startsWith(b, [0x00, 0x61, 0x73, 0x6d])) return { binary: 'wasm' };
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0])) return { binary: 'ole' };
  if (ascii(b, 0, 2) === '#!') return { binary: 'script' };
  // Texto: ignora BOM UTF-8 e espaços e olha o primeiro caractere ("<" = SVG/HTML/XML, qualquer que seja o nome do arquivo).
  let i = startsWith(b, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < b.length && i < 4096 && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x0c)) i++;
  if (b[i] === 0x3c) {
    const head = ascii(b, i, 400).toLowerCase();
    return { markup: head.includes('<svg') ? 'svg' : /^<(?:!doctype\s+html|html|head|body|script|meta|iframe|div|a\s|p[\s>])/.test(head) ? 'html' : head.startsWith('<?xml') && head.includes('<svg') ? 'svg' : 'xml' };
  }
  if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) return { text: true, utf16: true };
  return { text: true };
}

/* ───────────── imagens ───────────── */

const u32 = (b, o) => b.readUInt32BE(o);
// Conteúdo ativo escondido dentro do arquivo (comentário de GIF/JPEG, chunk de texto de PNG…): classic "polyglot"
const ACTIVE_MARKUP = /<\s*(?:script|iframe|html|svg|object|embed)|<\?php|<!doctype\s+html/i;
function assertNoActiveMarkup(b) {
  if (ACTIVE_MARKUP.test(b.toString('latin1'))) throw reject('conteudo_ativo_embutido', 'A imagem contém código embutido (script/HTML) e foi recusada.');
}
function assertDims(w, h) {
  if (!(w > 0 && h > 0)) throw reject('dimensoes_invalidas', 'Imagem com dimensões inválidas.');
  if (w > LIMITS.maxDimension || h > LIMITS.maxDimension) throw reject('dimensoes_excedidas', `A imagem excede ${LIMITS.maxDimension} px de largura ou altura.`);
  if (w * h > LIMITS.maxPixels) throw reject('pixels_excedidos', 'A imagem tem pixels demais (máximo 100 megapixels).');
}

/** PNG: percorre os chunks (CRC dos críticos), exige IEND como fim exato. Devolve {width,height,frames}. */
function parsePng(b) {
  if (b.length < 8 + 25 + 12) throw reject('png_truncado', 'Imagem PNG incompleta.');
  let pos = 8, width = 0, height = 0, frames = 1, sawIdat = false, first = true;
  for (let guard = 0; guard < 1_000_000; guard++) {
    if (pos + 12 > b.length) throw reject('png_truncado', 'Imagem PNG incompleta.');
    const len = u32(b, pos), type = ascii(b, pos + 4, 4), end = pos + 12 + len;
    if (len > 0x7fffffff || end > b.length) throw reject('png_truncado', 'Imagem PNG incompleta.');
    if (first && type !== 'IHDR') throw reject('png_invalido', 'Imagem PNG inválida.');
    if (type === 'IHDR' || type === 'PLTE' || type === 'IDAT' || type === 'IEND') {
      if ((zlib.crc32(b.subarray(pos + 4, pos + 8 + len)) >>> 0) !== u32(b, pos + 8 + len)) throw reject('png_corrompido', 'Imagem PNG corrompida.');
    }
    if (type === 'IHDR') { if (len !== 13) throw reject('png_invalido', 'Imagem PNG inválida.'); width = u32(b, pos + 8); height = u32(b, pos + 12); assertDims(width, height); }
    else if (type === 'IDAT') sawIdat = true;
    else if (type === 'acTL' && len === 8) { frames = u32(b, pos + 8); if (frames > LIMITS.maxFrames) throw reject('animacao_longa', `A animação tem mais de ${LIMITS.maxFrames} quadros.`); }
    first = false; pos = end;
    if (type === 'IEND') break;
  }
  if (!sawIdat) throw reject('png_truncado', 'Imagem PNG sem dados.');
  if (pos !== b.length) throw reject('dados_apos_o_fim', 'A imagem tem dados depois do fim do arquivo e foi recusada.');
  return { width, height, frames };
}

/** GIF: percorre blocos até o trailer (0x3B), contando quadros; nada pode sobrar depois do trailer. */
function parseGif(b) {
  const trunc = () => reject('gif_truncado', 'Imagem GIF incompleta.');
  if (b.length < 14) throw trunc();
  const width = b.readUInt16LE(6), height = b.readUInt16LE(8), flags = b[10];
  assertDims(width, height);
  let pos = 13 + (flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0), frames = 0;
  const skipSub = () => { for (;;) { if (pos >= b.length) throw trunc(); const n = b[pos++]; if (n === 0) return; pos += n; } };
  for (;;) {
    if (pos >= b.length) throw trunc();
    const t = b[pos++];
    if (t === 0x3b) break;
    if (t === 0x21) { pos += 1; skipSub(); }
    else if (t === 0x2c) {
      if (pos + 9 > b.length) throw trunc();
      const f = b[pos + 8]; pos += 9;
      if (f & 0x80) pos += 3 * 2 ** ((f & 7) + 1);
      pos += 1; skipSub(); frames++;
      if (frames > LIMITS.maxFrames) throw reject('animacao_longa', `A animação tem mais de ${LIMITS.maxFrames} quadros.`);
    } else throw reject('gif_invalido', 'Imagem GIF inválida.');
  }
  if (pos !== b.length) throw reject('dados_apos_o_fim', 'A imagem tem dados depois do fim do arquivo e foi recusada.');
  if (frames < 1) throw reject('gif_truncado', 'Imagem GIF sem quadros.');
  return { width, height, frames };
}

/** WebP: confere o tamanho RIFF e percorre os chunks, contando quadros de animação (ANMF). */
function parseWebp(b) {
  if (b.length < 20) throw reject('webp_truncado', 'Imagem WebP incompleta.');
  const riff = b.readUInt32LE(4) + 8;
  if (riff < b.length) throw reject('dados_apos_o_fim', 'A imagem tem dados depois do fim do arquivo e foi recusada.');
  if (riff > b.length) throw reject('webp_truncado', 'Imagem WebP incompleta.');
  let pos = 12, frames = 0, chunks = 0;
  while (pos + 8 <= b.length) {
    const size = b.readUInt32LE(pos + 4), type = ascii(b, pos, 4);
    const next = pos + 8 + size + (size & 1);
    if (next > b.length + 1 || pos + 8 + size > b.length) throw reject('webp_truncado', 'Imagem WebP incompleta.');
    if (type === 'ANMF') { frames++; if (frames > LIMITS.maxFrames) throw reject('animacao_longa', `A animação tem mais de ${LIMITS.maxFrames} quadros.`); }
    pos = next;
    if (++chunks > 1_000_000) throw reject('webp_invalido', 'Imagem WebP inválida.');
  }
  return { frames: Math.max(frames, 1) };
}

/** JPEG: SOI + (ao menos um) EOI. Dados depois do EOI são toleráveis (fotos com miniatura/MPF/Live Photo), mas passam pelo scan de conteúdo ativo. */
function checkJpeg(b) {
  if (b.indexOf(Buffer.from([0xff, 0xd9])) < 0) throw reject('jpeg_truncado', 'Imagem JPEG incompleta.');
}

const IMG_FORMAT = { png: 'png', jpeg: 'jpeg', gif: 'gif', webp: 'webp' };
async function validateImage(b, type) {
  let frames = 1, w, h;
  if (type === 'png') ({ width: w, height: h, frames } = parsePng(b));
  else if (type === 'gif') ({ width: w, height: h, frames } = parseGif(b));
  else if (type === 'webp') ({ frames } = parseWebp(b));
  else checkJpeg(b);
  assertNoActiveMarkup(b);
  // Decodificação real com sharp: limite de pixels, truncamento e arquivo ilegível viram 422. Decodifica só o 1º quadro,
  // reduzido (shrink-on-load no JPEG/WebP), para ficar barato mesmo com imagens grandes.
  let meta;
  try {
    meta = await sharp(b, { limitInputPixels: LIMITS.maxPixels, failOn: 'truncated', sequentialRead: true }).metadata();
    if (meta.format !== IMG_FORMAT[type]) throw reject('tipo_inconsistente', 'O conteúdo do arquivo não corresponde ao tipo da imagem.');
    w = meta.width; h = meta.height;
    if (meta.orientation >= 5 && meta.orientation <= 8) [w, h] = [h, w]; // EXIF girou: o navegador mostra largura/altura trocadas
    assertDims(meta.width, meta.height);
    if (frames > 1 && meta.width * meta.height * frames > LIMITS.maxAnimatedPixels) throw reject('animacao_pesada', 'A animação é pesada demais (muitos quadros grandes).');
    await sharp(b, { limitInputPixels: LIMITS.maxPixels, failOn: 'truncated', sequentialRead: true }).resize({ width: 32, height: 32, fit: 'inside' }).raw().toBuffer();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw reject(/pixel limit/i.test(String(e && e.message)) ? 'pixels_excedidos' : 'imagem_ilegivel', 'Não foi possível ler a imagem: o arquivo está corrompido ou incompleto.');
  }
  return { width: w, height: h };
}

/* ───────────── PDF ───────────── */

function validatePdf(b) {
  if (!/^%PDF-\d\.\d/.test(ascii(b, 0, 8))) throw reject('pdf_invalido', 'Arquivo PDF inválido.');
  if (!b.subarray(Math.max(0, b.length - 2048)).includes('%%EOF')) throw reject('pdf_incompleto', 'Arquivo PDF incompleto ou corrompido.');
}

/* ───────────── ZIP / PPTX ───────────── */

const inflateRaw = promisify(zlib.inflateRaw);
const SMALL_ENTRY = 64 * KiB;

function findEocd(b) {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  let from = b.length - 22;
  const min = Math.max(0, b.length - 22 - 65535);
  while (from >= min) {
    const p = b.lastIndexOf(sig, from);
    if (p < min) break;
    if (p + 22 + b.readUInt16LE(p + 20) === b.length) return p; // o comprimento do comentário tem de fechar exatamente com o fim do arquivo
    from = p - 1;
  }
  return -1;
}

/** Lê o diretório central SEM descompactar nada e aplica os limites anti zip-bomb. */
function readZipDirectory(b) {
  const bad = () => reject('zip_invalido', 'Arquivo ZIP/PPTX inválido ou corrompido.');
  const e = findEocd(b);
  if (e < 0) throw bad();
  const disk = b.readUInt16LE(e + 4), cdDisk = b.readUInt16LE(e + 6), nDisk = b.readUInt16LE(e + 8), n = b.readUInt16LE(e + 10);
  const cdSize = b.readUInt32LE(e + 12), cdOff = b.readUInt32LE(e + 16);
  if (disk !== 0 || cdDisk !== 0 || nDisk !== n) throw reject('zip_segmentado', 'ZIP em várias partes não é aceito.');
  if (n === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw reject('zip64_nao_suportado', 'ZIP64 não é aceito.');
  if (n > LIMITS.zipMaxEntries) throw reject('entradas_demais', `O arquivo tem mais de ${LIMITS.zipMaxEntries} itens internos.`);
  if (n === 0 || cdOff + cdSize > e) throw bad();
  const entries = [], seen = new Set();
  let p = cdOff, total = 0;
  for (let i = 0; i < n; i++) {
    if (p + 46 > cdOff + cdSize || b.readUInt32LE(p) !== 0x02014b50) throw bad();
    const flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
    const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    if (p + 46 + nl + xl + cl > cdOff + cdSize) throw bad();
    if (flags & 0x41) throw reject('zip_protegido', 'Arquivo protegido por senha não é aceito.');
    if (method !== 0 && method !== 8) throw reject('metodo_nao_suportado', 'O arquivo usa compressão não suportada.');
    if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) throw reject('zip64_nao_suportado', 'ZIP64 não é aceito.');
    if (method === 0 && csize !== usize) throw bad();
    if (nl === 0 || nl > LIMITS.zipMaxNameLen) throw reject('nome_invalido', 'O arquivo tem itens com nome inválido.');
    const rawName = b.subarray(p + 46, p + 46 + nl);
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    const norm = name.replace(/\\/g, '/');
    if (name.includes('\0') || norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').includes('..')) throw reject('caminho_perigoso', 'O arquivo contém caminhos inseguros (../ ou absolutos).');
    const lc = norm.toLowerCase();
    if (seen.has(lc)) throw reject('entradas_duplicadas', 'O arquivo tem itens duplicados.');
    seen.add(lc);
    total += usize;
    if (total > LIMITS.zipMaxUncompressed) throw reject('zip_bomb', 'O conteúdo descompactado é grande demais.');
    if (usize > LIMITS.zipMinBytesForRatio && usize / Math.max(csize, 1) > LIMITS.zipMaxRatio) throw reject('zip_bomb', 'Taxa de compressão suspeita (possível ZIP bomb).');
    entries.push({ name: norm, rawName, method, crc, csize, usize, off, dir: norm.endsWith('/') });
    p += 46 + nl + xl + cl;
  }
  if (total / Math.max(b.length, 1) > LIMITS.zipMaxRatio && total > LIMITS.zipMinBytesForRatio) throw reject('zip_bomb', 'Taxa de compressão suspeita (possível ZIP bomb).');
  return { entries, cdOff, total };
}

/** Descompacta (com limite) cada item e confere tamanho e CRC32: cabeçalho mentiroso não passa e o total real também respeita o teto. */
async function verifyZipEntries(b, { entries, cdOff }) {
  const bad = (m = 'Arquivo ZIP/PPTX corrompido.') => reject('zip_corrompido', m);
  let inflated = 0, since = 0;
  for (const en of entries) {
    if (en.dir) continue;
    const o = en.off;
    if (o + 30 > cdOff || b.readUInt32LE(o) !== 0x04034b50) throw bad();
    const ln = b.readUInt16LE(o + 26), lx = b.readUInt16LE(o + 28);
    const start = o + 30 + ln + lx, end = start + en.csize;
    if (end > cdOff) throw bad();
    if (!b.subarray(o + 30, o + 30 + ln).equals(en.rawName)) throw bad('O arquivo ZIP/PPTX é inconsistente.');
    const data = b.subarray(start, end);
    let size, crc;
    if (en.method === 0) { size = data.length; crc = zlib.crc32(data) >>> 0; }
    else if (en.usize === 0) { size = 0; crc = 0; }
    else if (en.usize <= SMALL_ENTRY) {
      let out;
      try { out = await inflateRaw(data, { maxOutputLength: en.usize }); } catch { throw bad(); }
      size = out.length; crc = zlib.crc32(out) >>> 0;
    } else {
      ({ size, crc } = await inflateBounded(data, en.usize, bad));
    }
    if (size !== en.usize || (en.usize > 0 && crc !== en.crc)) throw bad();
    inflated += size; since += size;
    if (inflated > LIMITS.zipMaxUncompressed) throw reject('zip_bomb', 'O conteúdo descompactado é grande demais.');
    if (since > 8 * MiB) { since = 0; await yieldLoop(); } // não monopoliza o laço de eventos com arquivos grandes
  }
}
async function inflateBounded(data, limit, bad) {
  const inf = zlib.createInflateRaw();
  let size = 0, crc = 0;
  try {
    inf.end(data);
    for await (const chunk of inf) {
      size += chunk.length;
      if (size > limit) { inf.destroy(); throw bad(); }
      crc = zlib.crc32(chunk, crc);
    }
  } catch (e) { if (e instanceof HttpError) throw e; throw bad(); }
  return { size, crc: crc >>> 0 };
}

async function validateZipAsPptx(b) {
  const dir = readZipDirectory(b);
  const names = dir.entries.map((x) => x.name.toLowerCase());
  const isPptx = names.includes('[content_types].xml') && names.some((x) => x.startsWith('ppt/'));
  if (!isPptx) throw unsupported('zip_generico', 'Arquivos ZIP genéricos não são aceitos. Envie um PowerPoint (.pptx).');
  if (names.some((x) => x.endsWith('vbaproject.bin') || x.endsWith('.exe') || x.endsWith('.dll'))) throw reject('macros_ou_executaveis', 'Apresentações com macros ou executáveis não são aceitas.');
  await verifyZipEntries(b, dir);
}

/* ───────────── CSV ───────────── */

const BAD_CSV_START = /^(?:<|#!|\/\*|\(\s*function\b|["']use strict["'])/;
function validateCsv(b) {
  if (b.length > LIMITS.csvBytes) throw E.tooLarge('O CSV excede 10 MB.');
  if (b.includes(0)) throw reject('csv_binario', 'O arquivo não parece um CSV (contém dados binários).');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { throw reject('csv_nao_utf8', 'O CSV precisa estar em UTF-8.'); }
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw reject('csv_binario', 'O arquivo não parece um CSV (contém caracteres de controle).');
  if (BAD_CSV_START.test(text.trimStart())) throw unsupported('csv_com_codigo', 'O arquivo parece código ou marcação, não um CSV.');
}

/* ───────────── API pública ───────────── */

/**
 * Valida bytes recebidos de um upload.
 * @param {Buffer|Uint8Array} bytes
 * @param {{kind?: 'image'|'thumb'|'attachment', maxBytes?: number}} [opts] maxBytes substitui o limite padrão do kind (uploads.max_bytes)
 * @returns {Promise<{mime:string, width?:number, height?:number, size:number}>}
 * @throws {HttpError} 413 | 415 | 422
 */
export async function validateUpload(bytes, { kind = 'image', maxBytes } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('validateUpload: bytes deve ser Buffer/Uint8Array');
  if (!Object.hasOwn(KIND_TYPES, kind)) throw E.badRequest('Tipo de envio inválido.', { fields: [{ path: 'kind', message: 'use image, thumb ou attachment' }] });
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cap = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : LIMITS.kindBytes[kind];
  if (b.length === 0) throw reject('arquivo_vazio', 'O arquivo está vazio.');
  if (b.length > cap) throw E.tooLarge(`O arquivo excede o limite de ${Math.floor(cap / MiB) || '< 1'} MB.`);

  const s = sniff(b);
  if (s.markup) throw unsupported('marcacao_nao_aceita', s.markup === 'svg' ? 'SVG não é aceito (pode conter scripts). Converta para PNG ou JPEG.' : 'Arquivos HTML/XML não são aceitos.');
  if (s.binary) throw unsupported(s.binary === 'zip' ? 'zip_generico' : 'binario_nao_aceito', s.binary === 'zip' ? 'Arquivos ZIP genéricos não são aceitos.' : 'Este tipo de arquivo não é aceito.');
  let type = s.type;
  if (!type) { // texto sem assinatura: só pode ser CSV, e só como anexo
    if (kind !== 'attachment') throw unsupported('tipo_desconhecido', 'Tipo de arquivo não reconhecido. Envie PNG, JPEG, WebP ou GIF.');
    if (s.utf16) throw reject('csv_nao_utf8', 'O CSV precisa estar em UTF-8.');
    type = 'csv';
  }
  if (type === 'zip') type = 'pptx'; // o ZIP só é aceito se for um PPTX (validado abaixo)
  if (!KIND_TYPES[kind].includes(type)) throw unsupported('tipo_nao_permitido_aqui', kind === 'attachment' ? 'Anexos aceitam PDF, PowerPoint (.pptx) e CSV.' : 'Este envio aceita imagens PNG, JPEG, WebP e GIF.');
  const typeCap = { pdf: LIMITS.pdfBytes, pptx: LIMITS.pptxBytes, csv: LIMITS.csvBytes }[type];
  if (typeCap && b.length > typeCap) throw E.tooLarge(`O arquivo excede o limite de ${Math.floor(typeCap / MiB)} MB para este tipo.`);

  if (type === 'pdf') validatePdf(b);
  else if (type === 'csv') validateCsv(b);
  else if (type === 'pptx') await validateZipAsPptx(b);
  else { const d = await validateImage(b, type); return { mime: MIME[type], width: d.width, height: d.height, size: b.length }; }
  return { mime: MIME[type], size: b.length };
}
