import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import zlib from 'node:zlib';
import { validateUpload, LIMITS, MIME } from '../../src/lib/asset-validate.js';
import { HttpError } from '../../src/lib/errors.js';
import * as fx from '../fixtures/make.js';

const MiB = 1024 * 1024;
/** Espera HttpError com status (e opcionalmente razão). */
async function denies(bytes, status, reason, opts) {
  try { await validateUpload(bytes, opts); } catch (e) {
    assert.ok(e instanceof HttpError, 'esperava HttpError, veio ' + (e && e.stack));
    assert.equal(e.status, status, `status ${e.status} ${e.code} ${JSON.stringify(e.details)} ${e.message}`);
    if (reason) assert.ok((e.details?.reasons || []).includes(reason), `esperava razão ${reason}, veio ${JSON.stringify(e.details)}`);
    return e;
  }
  assert.fail('deveria ter sido recusado');
}

describe('imagens válidas: tipo por magic bytes, dimensões e tamanho', () => {
  test('PNG, JPEG, WebP e GIF reais', async () => {
    const png = await fx.png(30, 20), jpg = await fx.jpeg(40, 10), webp = await fx.webp(16, 24), gif = fx.gif(1);
    assert.deepEqual(await validateUpload(png), { mime: 'image/png', width: 30, height: 20, size: png.length });
    assert.deepEqual(await validateUpload(jpg), { mime: 'image/jpeg', width: 40, height: 10, size: jpg.length });
    assert.deepEqual(await validateUpload(webp), { mime: 'image/webp', width: 16, height: 24, size: webp.length });
    assert.deepEqual(await validateUpload(gif), { mime: 'image/gif', width: 1, height: 1, size: gif.length });
  });
  test('aceita Uint8Array e Buffer que é "view" de um buffer maior', async () => {
    const png = await fx.png(5, 5); const big = Buffer.concat([Buffer.from('xx'), png, Buffer.from('yy')]);
    assert.equal((await validateUpload(new Uint8Array(png))).mime, 'image/png');
    assert.equal((await validateUpload(big.subarray(2, 2 + png.length))).mime, 'image/png');
  });
  test('JPEG com orientação EXIF 6 devolve largura/altura como o navegador exibe (trocadas)', async () => {
    const j = await sharp({ create: { width: 40, height: 10, channels: 3, background: '#fff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const r = await validateUpload(j); assert.deepEqual([r.width, r.height], [10, 40]);
  });
  test('o tipo vem do CONTEÚDO: nome e Content-Type do cliente, se passados, são ignorados', async () => {
    const png = await fx.png(4, 4);
    const r = await validateUpload(png, { kind: 'image', filename: 'foto.svg', contentType: 'image/svg+xml', mime: 'text/html' });
    assert.equal(r.mime, 'image/png');
  });
  test('thumb aceita png/jpeg/webp, recusa gif; image recusa documentos', async () => {
    assert.equal((await validateUpload(await fx.webp(), { kind: 'thumb' })).mime, 'image/webp');
    await denies(fx.gif(1), 415, 'tipo_nao_permitido_aqui', { kind: 'thumb' });
    await denies(fx.pdf(), 415, 'tipo_nao_permitido_aqui', { kind: 'image' });
    await denies(fx.minimalPptx(), 415, 'tipo_nao_permitido_aqui', { kind: 'image' });
    await denies(await fx.png(), 415, 'tipo_nao_permitido_aqui', { kind: 'attachment' });
  });
});

describe('imagens: limites de tamanho por kind', () => {
  test('image 25 MiB, thumb 512 KiB, attachment 100 MiB (em bytes, antes de qualquer análise)', async () => {
    assert.equal(LIMITS.kindBytes.image, 25 * MiB); assert.equal(LIMITS.kindBytes.thumb, 512 * 1024); assert.equal(LIMITS.kindBytes.attachment, 100 * MiB);
    await denies(Buffer.alloc(25 * MiB + 1), 413, undefined, { kind: 'image' });
    await denies(Buffer.alloc(512 * 1024 + 1), 413, undefined, { kind: 'thumb' });
    await denies(Buffer.alloc(100 * MiB + 1), 413, undefined, { kind: 'attachment' });
  });
  test('maxBytes (uploads.max_bytes) substitui o limite do kind', async () => {
    const png = await fx.png(64, 64);
    await denies(png, 413, undefined, { kind: 'image', maxBytes: png.length - 1 });
    assert.equal((await validateUpload(png, { kind: 'image', maxBytes: png.length })).mime, 'image/png');
    await denies(await fx.noisy('png', 450, 450), 413, undefined, { kind: 'thumb' }); // ruído 450×450 ≈ 600 KB > 512 KiB do thumb
    assert.equal((await validateUpload(await fx.noisy('png', 100, 100), { kind: 'thumb' })).mime, 'image/png');
  });
  test('arquivo vazio e kind inválido', async () => {
    await denies(Buffer.alloc(0), 422, 'arquivo_vazio');
    await denies(await fx.png(), 400, undefined, { kind: 'avatar' });
    await assert.rejects(() => validateUpload('texto'), TypeError); await assert.rejects(() => validateUpload(null), TypeError);
  });
});

describe('disfarces e tipos proibidos (415)', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>';
  const cases = [
    ['SVG', svg], ['SVG com BOM e espaços', '\ufeff \n\t' + svg], ['SVG com prólogo XML', '<?xml version="1.0"?>' + svg], ['SVG com doctype', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">' + svg],
    ['HTML com doctype', '<!DOCTYPE html><html><body><script>alert(1)</script></body></html>'], ['HTML começando em <script>', '<script>alert(1)</script>'], ['HTML começando em <img>', '<img src=x onerror=alert(1)>'],
    ['XML genérico', '<?xml version="1.0"?><a><b/></a>'], ['HTML com espaços/linhas antes', '\n\n\n   <html><body>oi</body></html>'],
  ];
  for (const kind of ['image', 'thumb', 'attachment']) for (const [nome, body] of cases) test(`${nome} disfarçado (kind=${kind})`, async () => { await denies(Buffer.from(body, 'utf8'), 415, 'marcacao_nao_aceita', { kind }); });
  test('SVG: mensagem orienta o usuário', async () => { const e = await denies(Buffer.from(svg), 415); assert.match(e.message, /SVG/); });
  test('executáveis e binários: EXE (MZ), ELF, Mach-O, WASM, OLE antigo (.doc/.ppt), script com shebang', async () => {
    const heads = { exe: [0x4d, 0x5a, 0x90, 0x00], elf: [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], macho: [0xcf, 0xfa, 0xed, 0xfe], javaclass: [0xca, 0xfe, 0xba, 0xbe], wasm: [0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0], ole: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], sh: [0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e] };
    for (const [n, h] of Object.entries(heads)) for (const kind of ['image', 'attachment']) await denies(Buffer.concat([Buffer.from(h), Buffer.alloc(200, 1)]), 415, 'binario_nao_aceito', { kind }).catch((e) => { throw new Error(n + ': ' + e.message); });
  });
  test('texto sem assinatura (JS, JSON, desconhecido) não é imagem', async () => {
    for (const t of ['alert(1)', '{"a":1}', 'GIF', 'hello world', '\u0001\u0002\u0003']) await denies(Buffer.from(t), 415, 'tipo_desconhecido', { kind: 'image' });
  });
  test('ZIP genérico (qualquer kind) e ZIP vazio/segmentado', async () => {
    await denies(fx.genericZip(), 415, 'zip_generico', { kind: 'attachment' });
    await denies(fx.genericZip(), 415, undefined, { kind: 'image' });
    const emptyZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
    await denies(emptyZip, 415, 'zip_generico', { kind: 'attachment' });
    // docx tem [Content_Types].xml mas não ppt/
    await denies(fx.zip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'word/document.xml', data: '<w/>' }]), 415, 'zip_generico', { kind: 'attachment' });
  });
});

describe('PNG: estrutura, truncamento, polyglot e limites', () => {
  test('truncado em vários pontos → 422', async () => {
    const p = await fx.noisy('png', 120, 120);
    for (const cut of [10, 40, Math.floor(p.length / 2), p.length - 20, p.length - 1]) await denies(p.subarray(0, cut), 422);
  });
  test('CRC do IDAT corrompido → 422 png_corrompido', async () => {
    const p = Buffer.from(await fx.noisy('png', 60, 60)); p[Math.floor(p.length / 2)] ^= 0xff; await denies(p, 422, 'png_corrompido');
  });
  test('dados depois do IEND (polyglot) → 422', async () => {
    await denies(Buffer.concat([await fx.png(), Buffer.from('<script>alert(1)</script>')]), 422, 'dados_apos_o_fim');
    await denies(Buffer.concat([await fx.png(), Buffer.from([0])]), 422, 'dados_apos_o_fim');
  });
  test('código escondido em chunk de texto (tEXt) → 422', async () => {
    const evil = fx.pngWithChunk(await fx.png(), 'tEXt', Buffer.from('Comment\0<script>alert(1)</script>'));
    await denies(evil, 422, 'conteudo_ativo_embutido');
    await denies(fx.pngWithChunk(await fx.png(), 'tEXt', Buffer.from('Comment\0<?php system($_GET[1]); ?>')), 422, 'conteudo_ativo_embutido');
  });
  test('metadado XMP legítimo (<x:xmpmeta>) NÃO é conteúdo ativo', async () => {
    const xmp = fx.pngWithChunk(await fx.png(), 'iTXt', Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>'));
    assert.equal((await validateUpload(xmp)).mime, 'image/png');
  });
  test('dimensões: 12000 passa na regra; 12001 não; > 100 MP não (sem alocar a imagem)', async () => {
    await denies(fx.pngHeaderOnly(13000, 10), 422, 'dimensoes_excedidas');
    await denies(fx.pngHeaderOnly(10, 12001), 422, 'dimensoes_excedidas');
    await denies(fx.pngHeaderOnly(11000, 10000), 422, 'pixels_excedidos');
    await denies(fx.pngHeaderOnly(0, 10), 422, 'dimensoes_invalidas');
  });
  test('limite de pixels também vale no sharp (12000x8400 = 100,8 MP passa o limite por lado, não o de pixels)', async () => {
    await denies(fx.pngHeaderOnly(12000, 8400), 422, 'pixels_excedidos');
  });
  test('imagem estruturalmente válida mas com dados de pixel ilegíveis → 422 imagem_ilegivel', async () => {
    await denies(fx.pngHeaderOnly(8, 8), 422, 'imagem_ilegivel');
  });
  test('APNG: > 500 quadros → 422; 500 passa', async () => {
    await denies(fx.pngWithChunk(await fx.png(), 'acTL', fx.acTL(501)), 422, 'animacao_longa');
    assert.equal((await validateUpload(fx.pngWithChunk(await fx.png(), 'acTL', fx.acTL(500)))).mime, 'image/png');
  });
  test('PNG sem IDAT, sem IHDR primeiro, IHDR com tamanho errado', async () => {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await denies(Buffer.concat([sig, Buffer.alloc(60)]), 422);
    const p = await fx.png(); await denies(p.subarray(0, 8 + 12 + 13), 422);
  });
});

describe('JPEG: truncamento e polyglot', () => {
  test('truncado → 422', async () => {
    const j = await fx.noisy('jpeg', 300, 300);
    for (const cut of [20, Math.floor(j.length / 3), Math.floor(j.length * 0.8), j.length - 3]) await denies(j.subarray(0, cut), 422);
  });
  test('código depois do EOI → 422; zeros de preenchimento são tolerados', async () => {
    const j = await fx.jpeg();
    await denies(Buffer.concat([j, Buffer.from('<script>alert(1)</script>')]), 422, 'conteudo_ativo_embutido');
    await denies(Buffer.concat([j, Buffer.from('<?php echo 1;')]), 422, 'conteudo_ativo_embutido');
    assert.equal((await validateUpload(Buffer.concat([j, Buffer.alloc(16)]))).mime, 'image/jpeg');
  });
  test('JPEG com bytes "extras" inofensivos depois do EOI (ex.: Live Photo) é aceito', async () => {
    assert.equal((await validateUpload(Buffer.concat([await fx.jpeg(), Buffer.from('MOTIONPHOTO-DATA-BINARIO'.repeat(10))]))).mime, 'image/jpeg');
  });
  test('comentário (COM) com HTML ativo → 422', async () => {
    const j = await fx.jpeg(); const com = Buffer.from('<script>alert(1)</script>');
    const seg = Buffer.concat([Buffer.from([0xff, 0xfe, (com.length + 2) >> 8, (com.length + 2) & 0xff]), com]);
    await denies(Buffer.concat([j.subarray(0, 2), seg, j.subarray(2)]), 422, 'conteudo_ativo_embutido');
  });
  test('só os 3 bytes de assinatura → 422 (não é 415)', async () => { await denies(Buffer.from([0xff, 0xd8, 0xff]), 422); });
  test('um EOI (FFD9) dentro da miniatura EXIF não mascara um JPEG principal truncado (quem pega é o sharp)', async () => {
    const main = await fx.noisy('jpeg', 300, 300), thumb = await fx.jpeg(8, 8);
    const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (thumb.length + 2) >> 8, (thumb.length + 2) & 0xff]), thumb]);
    for (const frac of [0.3, 0.6, 0.9, 0.98]) {
      const cut = main.subarray(0, Math.floor(main.length * frac));
      await denies(Buffer.concat([cut.subarray(0, 2), seg, cut.subarray(2)]), 422, 'imagem_ilegivel');
    }
    assert.equal((await validateUpload(Buffer.concat([main.subarray(0, 2), seg, main.subarray(2)]))).mime, 'image/jpeg'); // inteiro, com miniatura: aceito
  });
});

describe('GIF: quadros, polyglot e estrutura', () => {
  test('1, 2 e 500 quadros passam; 501 → 422 animacao_longa', async () => {
    for (const n of [1, 2, 500]) assert.equal((await validateUpload(fx.gif(n))).mime, 'image/gif');
    await denies(fx.gif(501), 422, 'animacao_longa'); await denies(fx.gif(5000), 422, 'animacao_longa');
  });
  test('polyglot: dados depois do trailer → 422', async () => {
    await denies(fx.gif(1, { trailing: Buffer.from('/*<script>alert(1)</script>*/') }), 422, 'dados_apos_o_fim');
    await denies(fx.gif(1, { trailing: Buffer.from([0]) }), 422, 'dados_apos_o_fim');
  });
  test('polyglot clássico GIF89a=1;alert(1) sem estrutura de GIF → 422', async () => {
    await denies(Buffer.from('GIF89a=1;alert(document.domain)//' + 'x'.repeat(40)), 422);
    await denies(Buffer.from('GIF89a/*<script>alert(1)</script>*/=1;'), 422);
  });
  test('comentário do GIF com HTML ativo → 422', async () => { await denies(fx.gif(1, { comment: '<script>alert(1)</script>' }), 422, 'conteudo_ativo_embutido'); });
  test('GIF sem trailer (cortado) ou cortado no meio de um bloco → 422', async () => {
    const g = fx.gif(3); await denies(g.subarray(0, g.length - 1), 422, 'gif_truncado'); await denies(g.subarray(0, 40), 422, 'gif_truncado');
  });
  test('bloco desconhecido → 422', async () => { const g = fx.gif(1); g[g.length - 1] = 0x99; await denies(Buffer.concat([g, Buffer.from([0x3b])]), 422); });
});

describe('WebP', () => {
  test('truncado e com dados depois do fim → 422', async () => {
    const w = await fx.webp(32, 32);
    await denies(w.subarray(0, w.length - 5), 422, 'webp_truncado');
    await denies(Buffer.concat([w, Buffer.from('<script>alert(1)</script>')]), 422, 'dados_apos_o_fim');
  });
  test('animação com > 500 quadros (ANMF) → 422', async () => {
    const chunk = (t, d) => { const h = Buffer.alloc(8); h.write(t, 0, 'latin1'); h.writeUInt32LE(d.length, 4); return Buffer.concat([h, d, d.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
    const mk = (n) => { const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', Buffer.alloc(10)), chunk('ANIM', Buffer.alloc(6)), ...Array.from({ length: n }, () => chunk('ANMF', Buffer.alloc(16)))]); const h = Buffer.alloc(8); h.write('RIFF', 0); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body]); };
    await denies(mk(501), 422, 'animacao_longa');
  });
});

describe('PDF', () => {
  test('válido', async () => { const p = fx.pdf(); assert.deepEqual(await validateUpload(p, { kind: 'attachment' }), { mime: 'application/pdf', size: p.length }); });
  test('sem %%EOF, ou com %%EOF fora dos últimos 2 KiB → 422', async () => {
    await denies(fx.pdf({ eof: false }), 422, 'pdf_incompleto', { kind: 'attachment' });
    await denies(Buffer.concat([fx.pdf(), Buffer.alloc(3000, 0x20)]), 422, 'pdf_incompleto', { kind: 'attachment' });
    assert.equal((await validateUpload(Buffer.concat([fx.pdf(), Buffer.alloc(1500, 0x20)]), { kind: 'attachment' })).mime, 'application/pdf');
  });
  test('cabeçalho sem versão → 422; PDF como imagem → 415', async () => {
    await denies(Buffer.from('%PDF-x\n%%EOF'), 422, 'pdf_invalido', { kind: 'attachment' });
    await denies(fx.pdf(), 415, undefined, { kind: 'image' });
  });
  test('não começa em %PDF- → não é PDF (cai em texto/CSV, nunca em application/pdf)', async () => {
    const r = await validateUpload(Buffer.concat([Buffer.from('lixo antes\n'), fx.pdf()]), { kind: 'attachment' }); assert.equal(r.mime, 'text/csv');
  });
});

describe('CSV', () => {
  const csv = (s) => Buffer.from(s, 'utf8');
  test('válido: BOM, ; , tab, acentos, aspas, quebras CRLF', async () => {
    for (const s of ['\ufeffnome;valor\r\nAna;1\r\nJoão;2\r\n', 'a,b,c\n"x, y",2,3\n', 'col\tcol2\nçãõ\t😀\n', 'um\n']) assert.deepEqual(await validateUpload(csv(s), { kind: 'attachment' }), { mime: 'text/csv', size: csv(s).length });
  });
  test('células com fórmula (=, +, -, @) são DADOS: aceitas (o export é que neutraliza, docs/API.md §6)', async () => { assert.equal((await validateUpload(csv('a,b\n=1+1,@SUM(A1)\n'), { kind: 'attachment' })).mime, 'text/csv'); });
  test('NUL / binário → 422; controles → 422; UTF-8 inválido → 422; UTF-16 → 422', async () => {
    await denies(Buffer.from('a,b\n1,\0\n'), 422, 'csv_binario', { kind: 'attachment' });
    await denies(csv('a,b\n1,\u0007\n'), 422, 'csv_binario', { kind: 'attachment' });
    await denies(Buffer.from([0x61, 0x2c, 0xe9, 0x0a]), 422, 'csv_nao_utf8', { kind: 'attachment' }); // "a,é" em latin1
    await denies(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\0,\0b\0', 'latin1')]), 422, 'csv_nao_utf8', { kind: 'attachment' });
  });
  test('> 10 MB → 413 (mesmo que o kind permita 100 MiB e maxBytes seja maior)', async () => {
    await denies(Buffer.alloc(10 * MiB + 1, 0x61), 413, undefined, { kind: 'attachment' });
    await denies(Buffer.alloc(10 * MiB + 1, 0x61), 413, undefined, { kind: 'attachment', maxBytes: 200 * MiB });
    assert.equal((await validateUpload(Buffer.alloc(10 * MiB, 0x61), { kind: 'attachment' })).mime, 'text/csv');
  });
  test('texto que parece código/marcação não vira CSV', async () => {
    for (const s of ['/* x */ alert(1)', '(function(){alert(1)})()', '"use strict"; alert(1)', "'use strict'; x()", '<b>oi</b>']) await denies(csv(s), 415, undefined, { kind: 'attachment' });
    await denies(csv('#!/bin/sh\nrm -rf /'), 415, 'binario_nao_aceito', { kind: 'attachment' });
  });
  test('CSV como imagem → 415', async () => { await denies(csv('a,b\n1,2\n'), 415, 'tipo_desconhecido', { kind: 'image' }); });
  test('cabeçalho "class,function,var" não é confundido com código', async () => { assert.equal((await validateUpload(csv('class,function,var\n1,2,3\n'), { kind: 'attachment' })).mime, 'text/csv'); });
});

describe('PPTX / ZIP', () => {
  test('PPTX real gerado pelo python-pptx (tests/fixtures/generate.py)', async (t) => {
    const real = fx.realPptx();
    if (!real) return t.skip('python3 com python-pptx indisponível neste ambiente');
    const r = await validateUpload(real, { kind: 'attachment' });
    assert.deepEqual(r, { mime: MIME.pptx, size: real.length });
  });
  test('PPTX mínimo; com comentário no fim do ZIP; entradas de diretório e vazias', async () => {
    assert.equal((await validateUpload(fx.minimalPptx(), { kind: 'attachment' })).mime, MIME.pptx);
    const withComment = fx.zip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'ppt/', data: '', method: 0 }, { name: 'ppt/vazio.xml', data: '' }, { name: 'ppt/slides/s1.xml', data: '<s/>' }], { comment: 'criado por teste' });
    assert.equal((await validateUpload(withComment, { kind: 'attachment' })).mime, MIME.pptx);
  });
  test('arquivo cortado / sem diretório central → 422', async () => {
    const z = fx.minimalPptx();
    await denies(z.subarray(0, z.length - 10), 422, 'zip_invalido', { kind: 'attachment' });
    await denies(z.subarray(0, 200), 422, 'zip_invalido', { kind: 'attachment' });
    await denies(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]), 422, 'zip_invalido', { kind: 'attachment' });
  });
  test('nomes perigosos: ../, ppt/../.., caminho absoluto, unidade de disco, barra invertida → 422', async () => {
    for (const name of ['../evil.xml', 'ppt/../../evil.xml', '/etc/passwd', 'C:\\Windows\\x.dll', '..\\evil.xml', 'ppt\\..\\..\\evil.xml', 'ppt/a\0b.xml'])
      await denies(fx.minimalPptx([{ name, data: 'x' }]), 422, 'caminho_perigoso', { kind: 'attachment' });
    assert.equal((await validateUpload(fx.minimalPptx([{ name: 'ppt/media/a..b.png', data: 'x' }]), { kind: 'attachment' })).mime, MIME.pptx); // ".." dentro do nome não é traversal
  });
  test('protegido por senha, método não suportado, duplicadas, macros/executáveis', async () => {
    await denies(fx.minimalPptx([{ name: 'ppt/x.xml', data: 'x', flags: 1 }]), 422, 'zip_protegido', { kind: 'attachment' });
    await denies(fx.minimalPptx([{ name: 'ppt/x.xml', data: 'x', method: 12 }]), 422, 'metodo_nao_suportado', { kind: 'attachment' });
    await denies(fx.minimalPptx([{ name: 'ppt/x.xml', data: 'a' }, { name: 'PPT/X.xml', data: 'b' }]), 422, 'entradas_duplicadas', { kind: 'attachment' });
    await denies(fx.minimalPptx([{ name: 'ppt/vbaProject.bin', data: 'MZ' }]), 422, 'macros_ou_executaveis', { kind: 'attachment' });
    await denies(fx.minimalPptx([{ name: 'ppt/embeddings/run.exe', data: 'MZ' }]), 422, 'macros_ou_executaveis', { kind: 'attachment' });
  });
  test('ZIP bomb: 64 MiB de zeros em ~64 KB (razão ~1000:1) → 422 zip_bomb, sem descompactar', async () => {
    const comp = await fx.deflatedZeros(64);
    assert.ok(comp.length < 200 * 1024, 'fixture deveria ser pequena: ' + comp.length);
    const bomb = fx.minimalPptx([{ name: 'ppt/bomb.bin', data: '', rawComp: comp, usize: 64 * MiB, crc: 0 }]);
    const t0 = performance.now(); await denies(bomb, 422, 'zip_bomb', { kind: 'attachment' }); assert.ok(performance.now() - t0 < 1000, 'tem de recusar pelo cabeçalho, rápido');
  });
  test('ZIP bomb forjado só no cabeçalho: usize de 4 GB, ou soma > 1 GiB em vários itens', async () => {
    await denies(fx.minimalPptx([{ name: 'ppt/a.bin', data: 'x', usize: 4_000_000_000 }]), 422, 'zip_bomb', { kind: 'attachment' });
    const three = fx.minimalPptx([0, 1, 2].map((i) => ({ name: `ppt/b${i}.bin`, data: 'x', method: 0, usize: 400 * MiB, csize: 400 * MiB })));
    await denies(three, 422, 'zip_bomb', { kind: 'attachment' });
  });
  test('cada defesa anti-bomba atua sozinha: razão por item, razão total e soma > 1 GiB', async () => {
    // (a) um item com razão ~1000:1 escondido entre itens incompressíveis (a razão TOTAL fica baixa; só a regra por item pega)
    const zeros2 = await fx.deflatedZeros(2);
    await denies(fx.minimalPptx([{ name: 'ppt/ruido.bin', data: await fx.noisy('png', 1300, 1000), method: 0 }, { name: 'ppt/zeros.bin', data: '', rawComp: zeros2, usize: 2 * MiB, crc: 0 }]), 422, 'zip_bomb', { kind: 'attachment' });
    // (b) 60 itens de exatamente 1 MiB (cada um abaixo do piso da regra por item), todos ~1000:1 → só a razão TOTAL pega
    const z1 = await fx.deflatedZeros(1);
    await denies(fx.minimalPptx(Array.from({ length: 60 }, (_, i) => ({ name: `ppt/z${i}.bin`, data: '', rawComp: z1, usize: MiB, crc: 0 }))), 422, 'zip_bomb', { kind: 'attachment' });
    // (c) 6 itens "190:1" (cada um e o total ficam abaixo de 200:1) somando 1,11 GiB → só o teto absoluto de 1 GiB pega
    const noise = (await fx.noisy('png', 600, 600)).subarray(0, 1_000_000);
    const six = fx.minimalPptx(Array.from({ length: 6 }, (_, i) => ({ name: `ppt/g${i}.bin`, data: '', rawComp: Buffer.concat([noise, Buffer.alloc(48576, i)]), usize: 190 * MiB, crc: 0 })));
    assert.ok(190 * 6 * MiB / six.length < 200, 'a fixture não pode disparar a razão total: ' + (190 * 6 * MiB / six.length));
    await denies(six, 422, 'zip_bomb', { kind: 'attachment' });
  });
  test('sem [Content_Types].xml (ou sem ppt/) não é PPTX', async () => {
    await denies(fx.zip([{ name: 'ppt/presentation.xml', data: '<x/>' }]), 415, 'zip_generico', { kind: 'attachment' });
    await denies(fx.zip([{ name: '[Content_Types].xml', data: '<x/>' }, { name: 'slides/s1.xml', data: '<x/>' }]), 415, 'zip_generico', { kind: 'attachment' });
  });
  test('cabeçalho que MENTE (diz 1000 bytes, o fluxo real é maior) → 422 zip_corrompido, pelos dois caminhos de descompressão', async () => {
    const small = fx.proseBytes(5000), large = fx.proseBytes(300 * 1024);
    await denies(fx.minimalPptx([{ name: 'ppt/m.xml', data: small, usize: 1000 }]), 422, 'zip_corrompido', { kind: 'attachment' });          // caminho síncrono limitado
    await denies(fx.minimalPptx([{ name: 'ppt/m.xml', data: large, usize: 100 * 1024 }]), 422, 'zip_corrompido', { kind: 'attachment' });   // caminho em fluxo
    await denies(fx.minimalPptx([{ name: 'ppt/m.xml', data: small, usize: 9000 }]), 422, 'zip_corrompido', { kind: 'attachment' });          // diz mais do que há
  });
  test('CRC errado, tamanho armazenado diferente, nome local ≠ nome central, dados fora da área → 422', async () => {
    await denies(fx.minimalPptx([{ name: 'ppt/x.xml', data: 'conteudo', crc: 12345 }]), 422, 'zip_corrompido', { kind: 'attachment' });
    await denies(fx.minimalPptx([{ name: 'ppt/x.xml', data: 'conteudo', method: 0, csize: 8, usize: 9 }]), 422, undefined, { kind: 'attachment' });
    await denies(fx.minimalPptx([{ name: 'ppt/x.xml', data: 'conteudo', localName: 'ppt/y.xml' }]), 422, 'zip_corrompido', { kind: 'attachment' });
    await denies(fx.minimalPptx([{ name: 'ppt/x.xml', data: 'conteudo', csize: 5000 }]), 422, 'zip_corrompido', { kind: 'attachment' });
  });
  test('> 20000 entradas → 422; exatamente 20000 passa', async () => {
    const many = (n) => fx.zip([{ name: '[Content_Types].xml', data: '<x/>' }, ...Array.from({ length: n - 1 }, (_, i) => ({ name: i === 0 ? 'ppt/p.xml' : `ppt/f${i}.xml`, data: 'x', method: 0 }))]);
    await denies(many(20001), 422, 'entradas_demais', { kind: 'attachment' });
    assert.equal((await validateUpload(many(20000), { kind: 'attachment' })).mime, MIME.pptx);
  });
  test('marcadores ZIP64 / multi-disco → 422', async () => {
    const z = Buffer.from(fx.minimalPptx()); const e = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const z64 = Buffer.from(z); z64.writeUInt16LE(0xffff, e + 10); z64.writeUInt16LE(0xffff, e + 8); await denies(z64, 422, 'zip64_nao_suportado', { kind: 'attachment' });
    const md = Buffer.from(z); md.writeUInt16LE(1, e + 4); await denies(md, 422, 'zip_segmentado', { kind: 'attachment' });
  });
  test('PPTX grande e legítimo (5 MiB de XML + 200 KiB de mídia) passa: razão de compressão normal não dispara', async () => {
    const z = fx.minimalPptx([{ name: 'ppt/slides/grande.xml', data: fx.proseBytes(5 * MiB) }, { name: 'ppt/media/foto.jpg', data: await fx.noisy('jpeg', 200, 200), method: 0 }, { name: 'ppt/media/img.png', data: await fx.noisy('png', 120, 120) }]);
    const t0 = performance.now(); assert.equal((await validateUpload(z, { kind: 'attachment' })).mime, MIME.pptx); assert.ok(performance.now() - t0 < 3000);
  });
  test('o laço de eventos continua respondendo durante a validação de um PPTX grande', async () => {
    const z = fx.minimalPptx(Array.from({ length: 6 }, (_, i) => ({ name: `ppt/slides/s${i}.xml`, data: fx.proseBytes(4 * MiB) })));
    let maxGap = 0, last = performance.now(); const iv = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 5);
    const t0 = performance.now(); await validateUpload(z, { kind: 'attachment' }); const total = performance.now() - t0; clearInterval(iv);
    // o trabalho pesado (descompressão + CRC) roda no threadpool e cede o laço: nenhuma pausa deve se aproximar do tempo total
    assert.ok(maxGap < Math.max(400, total / 2), `laço bloqueado por ${maxGap.toFixed(0)} ms (validação inteira: ${total.toFixed(0)} ms)`);
  });
  test('ZIP de imagem disfarçado de .png (assinatura PK) não vira imagem', async () => { await denies(fx.minimalPptx(), 415, undefined, { kind: 'image' }); });
  test('polyglot ZIP+HTML: dados depois do fim do ZIP (EOCD não fecha com o fim do arquivo) → 422', async () => {
    await denies(Buffer.concat([fx.minimalPptx(), Buffer.from('<script>alert(1)</script>')]), 422, 'zip_invalido', { kind: 'attachment' });
    await denies(Buffer.concat([fx.minimalPptx(), Buffer.from([0])]), 422, 'zip_invalido', { kind: 'attachment' });
  });
});

describe('carga: validações concorrentes (cenário de 50 usuários enviando ao mesmo tempo)', () => {
  test('50 imagens + 10 PPTX em paralelo: todos validados, laço de eventos responsivo, tempo total razoável', async () => {
    const imgs = await Promise.all(Array.from({ length: 5 }, (_, i) => fx.noisy(i % 2 ? 'png' : 'jpeg', 400 + i * 20, 300)));
    const pptx = fx.minimalPptx([{ name: 'ppt/slides/s1.xml', data: fx.proseBytes(2 * MiB) }]);
    let maxGap = 0, last = performance.now(); const iv = setInterval(() => { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 10);
    const t0 = performance.now();
    const rs = await Promise.all([...Array.from({ length: 50 }, (_, i) => validateUpload(imgs[i % 5])), ...Array.from({ length: 10 }, () => validateUpload(pptx, { kind: 'attachment' }))]);
    const ms = performance.now() - t0; clearInterval(iv);
    assert.equal(rs.length, 60); assert.ok(rs.every((r) => r.mime)); assert.ok(ms < 15000, `demorou ${ms.toFixed(0)} ms`); assert.ok(maxGap < 1500, `laço de eventos parado por ${maxGap.toFixed(0)} ms`);
  });
});
