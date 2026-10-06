/* Fixtures binárias geradas POR CÓDIGO (nada de arquivo grande versionado). Usadas por asset-validate.test.js e pelos testes de armazenamento.
   - imagens reais via sharp; GIF montado à mão (para controlar nº de quadros); PNG "só cabeçalho" para testar limites de pixels sem alocar memória;
   - ZIP escrito à mão (permite forjar cabeçalhos: zip bomb, nomes com "..", tamanho mentiroso);
   - PPTX real via python-pptx (generate.py), com `null` se o Python/python-pptx não existir. */
import sharp from 'sharp';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const crc = (b) => zlib.crc32(b) >>> 0;

/* ───── imagens ───── */
export const png = (w = 8, h = 8, bg = '#F78C16') => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
export const jpeg = (w = 16, h = 16, bg = '#002A46') => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).jpeg({ quality: 80 }).toBuffer();
export const webp = (w = 16, h = 16, bg = '#43698F') => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).webp().toBuffer();
/** Foto "de verdade" (ruído) para o JPEG/PNG ter dados suficientes para truncar. */
export const noisy = async (fmt = 'jpeg', w = 200, h = 200) => {
  // bytes incompressíveis e determinísticos (cadeia de SHA-256): o PNG/JPEG resultante tem tamanho previsível (~ w*h*3)
  const raw = Buffer.alloc(w * h * 3); for (let i = 0; i < raw.length; i += 32) createHash('sha256').update(String(i)).digest().copy(raw, i, 0, Math.min(32, raw.length - i));
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })[fmt]().toBuffer();
};

const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** PNG com IHDR declarando w×h e um IDAT qualquer: basta para testar limites de dimensão/pixels sem gerar pixels. */
export function pngHeaderOnly(w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(8))), chunk('IEND', Buffer.alloc(0))]);
}
/** Insere um chunk (ex.: acTL de APNG, tEXt com script) logo depois do IHDR de um PNG válido. */
export function pngWithChunk(buf, type, data) { const at = 8 + 12 + 13; return Buffer.concat([buf.subarray(0, at), chunk(type, data), buf.subarray(at)]); }
export const acTL = (frames) => { const d = Buffer.alloc(8); d.writeUInt32BE(frames, 0); return d; };

/** GIF 1×1 com N quadros, montado byte a byte. */
export function gif(frames = 1, { trailing = Buffer.alloc(0), comment = null } = {}) {
  const head = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff]);
  const frame = Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00]);
  const parts = [head];
  if (comment) parts.push(Buffer.from([0x21, 0xfe, comment.length]), Buffer.from(comment, 'latin1'), Buffer.from([0x00]));
  for (let i = 0; i < frames; i++) parts.push(frame);
  parts.push(Buffer.from([0x3b]), trailing);
  return Buffer.concat(parts);
}

/** PDF mínimo e válido (texto simples). eof=false remove o %%EOF (arquivo cortado). */
export function pdf({ eof = true } = {}) {
  const body = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\nstartxref\n0\n';
  return Buffer.from(eof ? body + '%%EOF\n' : body, 'latin1');
}

/* ───── ZIP escrito à mão ───── */
/** entries: [{name, data, method=8|0, crc?, usize?, csize?, flags?, rawComp?, localName?}] — campos opcionais servem para FORJAR cabeçalhos. */
export function zip(entries, { comment = '' } = {}) {
  const parts = [], cd = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), lname = e.localName ? Buffer.from(e.localName, 'utf8') : name;
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '');
    const method = e.method ?? 8;
    const comp = e.rawComp ?? (method === 8 ? zlib.deflateRawSync(raw) : raw);
    const c = e.crc ?? crc(raw), usize = e.usize ?? raw.length, csize = e.csize ?? comp.length, flags = (e.flags ?? 0) | 0x800;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(csize, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(lname.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(csize, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, lname, comp); cd.push(ch, name);
    off += 30 + lname.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd), cm = Buffer.from(comment);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(off, 16); eocd.writeUInt16LE(cm.length, 20);
  return Buffer.concat([...parts, cdBuf, eocd, cm]);
}
const CT = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>';
/** PPTX mínimo (só o esqueleto exigido: [Content_Types].xml e ppt/…). */
export const minimalPptx = (extra = []) => zip([{ name: '[Content_Types].xml', data: CT }, { name: 'ppt/presentation.xml', data: '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>' }, ...extra]);
/** ZIP qualquer (sem [Content_Types].xml/ppt/): "zip genérico". */
export const genericZip = () => zip([{ name: 'leiame.txt', data: 'olá' }]);
/** DEFLATE de N MiB de zeros em fluxo (sem alocar tudo): razão de compressão ~1000:1. */
export async function deflatedZeros(mib) {
  const d = zlib.createDeflateRaw({ level: 9 }), chunks = [], one = Buffer.alloc(1024 * 1024);
  d.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => d.on('end', r));
  for (let i = 0; i < mib; i++) if (!d.write(one)) await new Promise((r) => d.once('drain', r));
  d.end(); await done;
  return Buffer.concat(chunks);
}
/** Texto "de verdade" (pouco repetitivo): compacta ~3x, como um slide XML. */
export function proseBytes(n) { let x = 7, out = ''; const w = ['slide', 'receita', 'margem', 'cliente', 'plano', 'risco', 'meta', 'valor', 'equipe', 'prazo']; while (out.length < n) { x = (x * 1103515245 + 12345) & 0x7fffffff; out += w[x % 10] + (x >> 8) % 997 + ' '; } return Buffer.from(out.slice(0, n)); }

/** PPTX real do python-pptx; null se python3/python-pptx não estiverem disponíveis. */
export function realPptx() {
  const dir = mkdtempSync(path.join(tmpdir(), 'canteiro-fx-'));
  try {
    const out = path.join(dir, 'real.pptx');
    const r = spawnSync('python3', ['-I', path.join(here, 'generate.py'), out], { encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) return null;
    return readFileSync(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
