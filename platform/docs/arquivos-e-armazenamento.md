# Arquivos, conteúdo e armazenamento de objetos

Este documento descreve as bibliotecas **puras** que protegem e guardam o que o usuário envia: imagens, anexos e o JSON das apresentações.
O contrato HTTP continua em `docs/API.md` (§4 e §5); aqui está o **como** e o **porquê**, com a operação (S3, backup, crescimento).

| Peça | Arquivo | Para quê |
|---|---|---|
| JSON canônico e hashes | `src/lib/canonical.js` | mesmo conteúdo → mesmos bytes → mesmo SHA-256 (detecta "nada mudou", versões, dedup) |
| Lint do deck | `src/lib/deck-lint.js` | segunda camada contra HTML ativo, imagens `data:` inchando o banco, `asset:` malformado, limites |
| Validação de upload | `src/lib/asset-validate.js` | tipo por magic bytes, imagem decodificada, PDF/PPTX/CSV estruturalmente válidos, anti zip-bomb |
| Armazenamento de objetos | `src/storage/{index,keys,local,s3}.js` | arquivos fora do banco, endereçados por SHA-256, drivers `local` e `s3` |

---

## 1. Princípios

1. **Banco só guarda metadados.** Bytes de imagem/arquivo vão para o armazenamento de objetos; o JSON do deck referencia `asset:sha256:<hex64>`.
2. **Endereçamento por conteúdo.** A chave do objeto é `a/<sha[0..2]>/<sha[2..4]>/<sha>`. O mesmo arquivo enviado mil vezes (ou por mil pessoas) é **um** objeto. Objetos nunca mudam depois de gravados — isso torna backup incremental e cache imutável triviais.
3. **Nenhuma entrada do cliente vira caminho.** A chave só nasce de um SHA validado por `/^[0-9a-f]{64}$/` (`typeof` estrito). Qualquer outra coisa lança `StorageKeyError`. Por construção não há *path traversal*.
4. **Tipo pelo conteúdo, nunca pelo nome.** O `Content-Type` e o nome do arquivo do cliente são ignorados.
5. **Nega por padrão.** Na dúvida (arquivo estranho, JSON suspeito) a resposta é 4xx; o editor mostra a mensagem e o usuário corrige.

---

## 2. `canonical.js`

```js
canonicalize(value) → string      // JSON com chaves ordenadas recursivamente, sem espaços
contentHash(value)  → hex64       // sha256(UTF-8(canonicalize(value)))
sha256Hex(bytesOrString) → hex64  // string = UTF-8; Buffer/Uint8Array/ArrayBuffer = bytes
```

- Ordem das chaves por unidade de código UTF-16 e números como no JS: idêntico ao **RFC 8785 (JCS)**. O teste usa o exemplo oficial do RFC (§3.2.3).
- `undefined` em objeto é omitido; em array vira `null` (como o JSON). `toJSON` é respeitado (`Date`).
- **Recusa** (`TypeError`) NaN, Infinity, BigInt, função, símbolo, Map/Set/binário e **ciclos** — um hash que "esconde" dado perdido seria pior que um erro. Referência compartilhada sem ciclo é permitida.
- `lintDeck` já recusa esses valores com 422, então `contentHash` depois do lint nunca lança.

---

## 3. `deck-lint.js`

```js
lintDeck(content, { maxBytes = 12 MiB } = {}) → { bytes, assetRefs:Set<hex64>, slideCount, title }
// ou lança HttpError 422 rejected_content com details = { reasons:[…], findings:[{reason, path}] }
```

### O que é verificado

| Regra | Razão (`details.reasons`) |
|---|---|
| raiz não é objeto simples com `slides` array; slide que não é objeto; ciclo/BigInt/função/Date/Map | `estrutura_invalida` |
| JSON > `maxBytes` (padrão 12 MiB, em UTF-8) | `tamanho_excedido` |
| > 500 slides | `slides_demais` |
| contêiner aninhado além de 40 níveis | `profundidade_excedida` |
| string > 2 MiB (em bytes UTF-8; vale para chaves também) | `string_grande_demais` |
| NaN / Infinity | `numero_invalido` |
| chave `__proto__` (poluição de protótipo) | `chave_proibida` |
| tags `script iframe object embed link meta base form` + `svg math style frame frameset applet template noscript xmp plaintext isindex` (aceita `</…`, namespace `x:script`, maiúsculas) | `tag_perigosa` |
| atributo `on…=` (qualquer), inclusive fuga de atributo (`" onmouseover=`, `' autofocus onfocus=`) | `atributo_evento` |
| `srcdoc` | `atributo_perigoso` |
| `javascript:`/`vbscript:`/`livescript:`/`file:` em `href src action formaction xlink:href background poster data ping srcset…`, em chaves JSON de URL (`href`, `src`, `url`, `link`, `sheet`, `webhook`…) e como valor solto `javascript:código` | `url_perigosa` |
| `data:text/html`, `data:text/javascript`, `data:application/xhtml+xml`, `data:text/xml` | `data_html` |
| `data:image/svg+xml` (qualquer tamanho) e `<svg` | `svg_embutido` |
| `expression()`, `@import`, `-moz-binding`, `behavior:`, `url()` que não seja `asset:` ou imagem pequena, dentro de `style="…"` ou de chaves `style`/`css` | `estilo_perigoso` |
| `data:image/(png\|jpeg\|webp\|gif)` com mais de 64 KB de base64 (inclusive "picado" com espaços/quebras) em qualquer string | `imagem_nao_externalizada` |
| qualquer `asset:` malformado (hex maiúsculo, ≠ 64 dígitos, algoritmo errado, `asset:../…`, esquema em maiúsculas…) | `referencia_asset_invalida` |

`assetRefs` são só as referências **válidas** (hex minúsculo, sem prefixo) vistas em valores e chaves. **Quem pode referenciar o quê** (posse do arquivo) é decisão da rota, não do lint.

### Como resiste a evasões

Cada string é decodificada **em camadas** (até 4): entidades HTML (nomeadas, decimais e hexadecimais, com ou sem `;`, com zeros à esquerda), `%XX`/`%uXXXX`, `\uXXXX`/`\u{…}`/`\xXX`. Todas as formas (original e decodificadas) são testadas com controles e caracteres invisíveis (NUL, zero-width, bidi, soft hyphen) removidos. Atributos são lidos por um tokenizador mínimo que segue as regras do navegador para aspas e separadores (`<img alt=">" onerror=…>`), e, além dele, há regras grossas ("qualquer `on…=` em string com `<`") para o caso de o tokenizador ser enganado (ex.: 300 atributos antes do `onerror`). Valores de `style` passam por *unescape* CSS (`\6a avascript`) e remoção de comentários (`exp/**/ression`).

Isto é um filtro de **recusa**, não um sanitizador. É defesa em profundidade: o editor já sanitiza ao abrir (`cleanHTML`/`safeDeck`) e a interface escapa texto.

### Falsos positivos: o que NÃO pode ser recusado

Texto comum passa: a palavra "script", "onclick/onerror" em prosa, setas (`→ ⇒ <- ->`), emoji (inclusive ZWJ), aspas, `a < b`, `x<y`, `AT&T`, `Q&A`, "Data: 12/05/2026", "Asset: Real Estate", "JavaScript: guia", "regular expression (regex)", caminhos `C:\Users\…`, URLs com `&`/`%20`, HTML do editor (`<span style>`, `<b>`, `<font>`, `<br>`, listas). O corpus está em `tests/fixtures/xss-corpus.js` (`LEGIT` ≥ 30 itens; `ATTACKS` ≥ 90). **Falso positivo aceito, documentado:**

- texto digitado literalmente como `<script>` (o editor o grava como `&lt;script&gt;`, que decodificamos de propósito: o requisito é pegar `&lt;script`);
- `asset:` colado em algo que não seja espaço (`Asset:Passivo`) é tratado como referência malformada — escreva `Asset: Passivo`;
- `onXXX=` logo depois de uma aspa, na mesma frase, é lido como fuga de atributo.

### Desempenho

Varredura linear (sem regex aninhada; há testes com 1 MB de espaços, `<`, `&#`, `%3C`, aspas…). Medido: 500 slides realistas (≈ 0,7 MB) em ~50 ms; 10 MB de prosa em ~0,2 s; 10 MB de HTML rico em ~0,9 s. É **síncrono**: um deck no limite de 12 MB segura o laço de eventos ~1 s (um autosave normal gasta dezenas de ms). Se isso virar problema, mover para `worker_threads` não muda a API.

---

## 4. `asset-validate.js`

```js
await validateUpload(bytes, { kind = 'image', maxBytes } = {}) → { mime, width?, height?, size }
// lança HttpError: 413 too_large · 415 unsupported_media · 422 rejected_content (details.reasons[])
```

| kind | tipos aceitos | limite padrão |
|---|---|---|
| `image` | PNG, JPEG, WebP, GIF | 25 MiB (`maxBytes` = `uploads.max_bytes`) |
| `thumb` | PNG, JPEG, WebP | 512 KiB |
| `attachment` | PDF (≤ 100 MiB), PPTX (≤ 100 MiB), CSV (≤ 10 MB) | 100 MiB |

O tipo vem dos **magic bytes**; SVG/HTML/XML (inclusive com BOM/espaços antes), EXE/ELF/Mach-O/WASM/OLE antigo/shebang, ZIP genérico e texto sem assinatura são **415**. O `kind` declara a intenção: PDF como `image` ou PNG como `attachment` também é 415.

**Imagens** — estrutura própria + decodificação com `sharp`:
- PNG: percorre os chunks (CRC dos críticos), `IEND` tem de ser o fim exato; APNG > 500 quadros recusado.
- GIF: percorre os blocos até o trailer `0x3B`, conta quadros (≤ 500), nada pode sobrar depois (polyglot).
- WebP: tamanho RIFF confere com o arquivo; quadros `ANMF` ≤ 500.
- JPEG: precisa ter EOI; bytes extras depois são tolerados (Live Photo/MPF) mas passam pelo scan abaixo.
- Dimensão ≤ 12 000 px por lado e ≤ 100 MP (`limitInputPixels`); animação com `largura×altura×quadros` > 10⁹ recusada; EXIF girado devolve largura/altura como o navegador mostra.
- `sharp` decodifica o 1º quadro reduzido com `failOn: 'truncated'`: arquivo cortado → 422; avisos inofensivos de câmera não derrubam.
- Scan de conteúdo ativo escondido (`<script`, `<iframe`, `<html`, `<svg`, `<?php`…) em qualquer parte do arquivo (comentário de GIF/JPEG, chunk `tEXt`): 422. Metadado XMP legítimo passa.

**PDF**: começa com `%PDF-<versão>` e tem `%%EOF` nos últimos 2 KiB.
**CSV**: UTF-8 estrito (BOM aceito), sem NUL nem controles, ≤ 10 MB, não pode começar como código/marcação. Células com `= + - @` são **dados** aceitos (a neutralização é na exportação, `docs/API.md` §6).
**PPTX/ZIP** — o diretório central é lido à mão, **sem descompactar** para decidir:

| Defesa | Limite |
|---|---|
| entradas | ≤ 20 000 |
| soma descompactada declarada | ≤ 1 GiB |
| razão de compressão | ≤ 200:1 (por item acima de 1 MiB **e** no total) |
| nomes | sem `..` (também com `\`), sem caminho absoluto/unidade de disco/NUL, ≤ 512 bytes, sem duplicatas (sem distinguir maiúsculas) |
| proibidos | senha, ZIP64, multi-disco, compressão que não seja store/deflate, `vbaProject.bin`/`.exe`/`.dll` |
| exigido | `[Content_Types].xml` e algum `ppt/…` (senão é "ZIP genérico" → 415) |
| EOCD | o comprimento do comentário tem de fechar com o fim do arquivo (dados depois do ZIP → 422, polyglot) |

Depois, **cada item é descompactado com teto** (memória constante, em *threadpool*, cedendo o laço de eventos) e confere tamanho e CRC-32: um cabeçalho que mente ("1000 bytes" para um fluxo de 10 MB) é recusado. O nome do cabeçalho local tem de bater com o do diretório central.

---

## 5. Armazenamento de objetos

```js
import { createStorage } from './storage/index.js';
const storage = createStorage(config);   // config.storage.driver = 'local' | 's3'
```

Interface (idêntica nos dois drivers; `sha` sempre 64 hex minúsculos, senão `StorageKeyError`):

| Método | Retorno | Notas |
|---|---|---|
| `put(sha, bytes, {mime, verify=true})` | `{created, size}` | **idempotente**; confere `sha256(bytes) === sha` (impede envenenar a dedup); `created:false` se já existe com o mesmo tamanho; objeto com tamanho errado é regravado ("cura") |
| `get(sha)` | `{body:Buffer, size}` ou `null` | carrega tudo na memória: prefira `getStream` para arquivos grandes |
| `getStream(sha)` | `{stream:ReadableStream (Web), size}` ou `null` | quem pede **deve consumir ou cancelar** o stream |
| `head(sha)` | `{size}` ou `null` | |
| `delete(sha)` | `{deleted:boolean}` | idempotente |
| `signedGetUrl(sha, {ttlS=300, filename, disposition='attachment', mime})` | URL ou `null` (local) | TTL ≤ 3600 s; **`attachment` por padrão** (só imagens devem ser `inline`); `mime` força o `Content-Type` da resposta; nome do arquivo sanitizado (sem CR/LF/aspas/barras) |
| `createUpload(sha, {size, mime, ttlS=300})` | `{url, method:'PUT', headers, expiresAt}` ou `null` (local) | assina `content-type`, `content-length`, `cache-control` e `x-amz-checksum-sha256`; o cliente envia exatamente `headers` (o navegador define `Content-Length`) |
| `verify(sha)` | `{ok, size, actualSha}` | relê o objeto em fluxo e confere o hash (objeto ausente → `ok:false, size:null`) |
| `list({prefix, limit, cursor})` | `{keys[], items[{sha,key,size,lastModified}], next}` | ordenado por sha; `prefix` = prefixo **hex** de sha (0–64); `cursor` = último sha da página anterior; `limit` ≤ 1000 |
| `ping()` | `boolean` | para `/api/ready` |

Erros: `StorageKeyError` (entrada inválida, `code:'invalid_object_key'`) e `StorageIntegrityError` (`sha_mismatch`, `empty`, `unsafe_path`, `too_large`). **Nenhum leva caminho, chave ou segredo na mensagem**; mapeie para 500/422 sem ecoar.

### Driver `local` (`STORAGE_LOCAL_DIR`)

Para desenvolvimento, testes e instalações pequenas (config.js proíbe em produção).
Escrita **atômica** (temporário no mesmo diretório + `fsync` + `rename`): leitor concorrente nunca vê objeto pela metade e queda no meio não deixa objeto corrompido. Permissões 0700/0600. **Não segue symlink**: as 3 pastas são conferidas com `lstat` a cada operação e o arquivo abre com `O_NOFOLLOW`. A *raiz* configurada pode ser um symlink (volume montado). Arquivos `.tmp-*` órfãos (queda do processo) são ignorados por `list` e podem ser apagados com segurança quando tiverem mais de 1 hora.

### Driver `s3` (AWS S3, Supabase Storage S3, Cloudflare R2, MinIO)

| Variável | Valor |
|---|---|
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | Supabase: `https://<ref>.storage.supabase.co/storage/v1/s3` · R2: `https://<conta>.r2.cloudflarestorage.com` · MinIO: `http://minio:9000` · AWS: omita |
| `S3_REGION` | Supabase: a do projeto · R2: `auto` · AWS: a do bucket |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | **só no servidor** (Supabase: as chaves S3 ignoram RLS, portanto jamais vão ao navegador) |
| `S3_FORCE_PATH_STYLE` | `true` (padrão) para Supabase/R2/MinIO |

Propriedades de segurança do driver:
- **Bucket sempre privado.** Nunca enviamos ACL, política nem `x-amz-grant-*` (testado). O navegador só acessa por URL assinada curta ou pela API.
- `Content-Type` e `Cache-Control: private, max-age=31536000, immutable` no objeto; sem outros metadados.
- **Integridade ponta a ponta:** o SHA-256 vai como `x-amz-checksum-sha256` (no `put` e **assinado** no upload direto), então o próprio provedor recusa bytes que não sejam os do hash da chave. Se o provedor não aceitar o cabeçalho (501/`NotImplemented`/erro de argumento citando checksum), o driver **degrada** e lembra; `BadDigest` (bytes errados) nunca degrada. Para forçar desligado: `storage.s3.checksum = 'off'` (hoje `config.js` não expõe essa variável — veja *Pendências*).
- Retentativas finitas (3, modo `standard`), `connectionTimeout` 5 s, `requestTimeout` 30 s. O SDK novo calcula CRC32 por padrão e vários S3-compatíveis ainda não aceitam; por isso `requestChecksumCalculation: 'WHEN_REQUIRED'`.
- Credenciais ficam em fechamento: `JSON.stringify(storage)`/`util.inspect` não as mostram (testado).

---

## 6. Fluxos (para quem escreve as rotas)

**Upload pela API (≤ 4 MB — limite do corpo das Functions da Vercel).**
`bytes → validateUpload → sha = sha256Hex(bytes) → (confere com :sha256 da URL) → storage.put(sha, bytes, {mime}) → INSERT app.assets (+ asset_uploads)`. Responda `deduplicated: !put.created`.

**Upload direto (acima de 4 MB).**
1. `POST /api/assets/uploads {sha256,size,mime,kind}`: valide `kind/mime/size` e **só então** `createUpload`. **Nunca emita URL para um sha que já esteja `ready`/referenciado** (devolva "já existe"): sem isso alguém reenviaria bytes para a chave de um objeto legítimo. A assinatura do checksum já faz o provedor recusar bytes que não casem com o sha, mas nem todo S3-compatível aplica isso.
2. O navegador faz `PUT` com `headers` exatamente como devolvidos.
3. `POST /api/assets/:sha/finalize`: `storage.verify(sha)`; se `!ok` → apague o objeto **somente se o registro ainda estiver `pending`** e responda 422. Se `ok`, baixe o início do objeto (ou `get` se pequeno) e rode `validateUpload` antes de marcar `ready` — o `verify` prova o hash, não o tipo.

**Download.** Imagem pequena: `getStream` e cabeçalhos `Content-Type` (do banco), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, max-age=31536000, immutable`, `Content-Disposition` via `contentDisposition()` (exportado de `storage/keys.js`). Arquivo grande/não-imagem: `302` para `signedGetUrl(sha, {disposition, filename, mime})`.

**Salvar deck.** `lintDeck(content)` → `contentHash(content)` → compara com `content_hash` (nada mudou?) → para cada `assetRefs`, a rota confere que o usuário tem posse/visão do arquivo (RLS `assets_select`) → grava `asset_refs`.

**Coleta de lixo.** `app.orphan_assets(age)` dá os candidatos; confira com `storage.head` e apague com `storage.delete`. Para achar **objetos órfãos sem linha no banco** (upload que morreu antes do INSERT), pagine `storage.list` e compare com `app.assets`; respeite `lastModified` > 14 dias antes de apagar.

---

## 7. Crescimento de 500 GB a 1 TB

- **Contagem de objetos.** Com média de 2 MB, 1 TB ≈ 500 mil objetos; 256×256 = 65 536 pastas folha ⇒ ~8 objetos por pasta (50 milhões ainda dariam < 800). O layout não vira gargalo no disco nem no S3 (prefixos bem distribuídos).
- **Banco não cresce com arquivos.** Cada arquivo = 1 linha em `app.assets` + referências; o deck guarda só `asset:sha256:…` (por isso o lint recusa `data:` > 64 KB).
- **Dedup global** reduz o crescimento real: logos e artes A&M reaparecem em milhares de decks.
- **Custo e limites do provedor**: veja `docs/pesquisa/supabase.md` §5 (Supabase Storage: arquivo até 500 GB, ~US$ 0,0213/GB-mês acima dos 100 GB inclusos; **sem versionamento nem backup dos objetos**) e `docs/pesquisa/alternativas-banco-arquivos.md` (R2, saída grátis). Não repetimos preços aqui para não envelhecerem.
- **Backup de objetos** (o Supabase não faz backup dos objetos e não versiona; apagar é definitivo): como objetos são **imutáveis e endereçados por hash**, a cópia é incremental e só acrescenta. Use `copy` (e **não** `sync`: `sync` propagaria ao backup um apagamento acidental da origem):
  ```bash
  # cópia periódica (ex.: diária) para um bucket de OUTRO provedor/conta
  rclone copy supabase:BUCKET/a  backup:BUCKET-copia/a --checksum --immutable --fast-list
  ```
  `--immutable` faz o rclone **falhar** se um objeto já copiado diferir da origem (sinal de adulteração ou corrupção). Teste de restauração: `list` + `verify` de uma amostra (1–2 %) no bucket restaurado, mensal.
- **Verificação periódica ("scrub")**: percorrer `list` e `verify` em lotes (ex.: 1 % por dia ⇒ ciclo completo em ~100 dias). Qualquer `ok:false` é incidente.
- **Importar o acervo local existente**: para cada arquivo, `sha256Hex` → `validateUpload` (descarte e relate o que for recusado) → `storage.put` → `INSERT app.assets` com `uploaded_by` = admin da importação. É idempotente: reexecutar não duplica nada.

---

## 8. Ameaças e onde são tratadas

| Ameaça | Defesa |
|---|---|
| SVG/HTML/JS disfarçado de `.png` | magic bytes + recusa de marcação (415) + decodificação com `sharp` |
| GIF/PNG/JPEG *polyglot* (script depois do fim ou em comentário) | fim exato do arquivo (PNG/GIF/WebP) + scan de conteúdo ativo |
| ZIP bomb / ZIP com `../` / macro | limites do diretório central + descompressão com teto + nomes/EOCD estritos + bloqueio de `vbaProject.bin` |
| PNG gigante (decompression bomb) | dimensão/pixels lidos do IHDR **antes** de decodificar + `limitInputPixels` |
| Path traversal / symlink no disco | chave só de SHA validado + `lstat` por pasta + `O_NOFOLLOW` + checagem de prefixo da raiz |
| Envenenar a dedup (bytes ≠ sha) | `put` e `verify` conferem o hash; checksum assinado no upload direto |
| Sobrescrever objeto legítimo por URL assinada | checksum assinado + a rota nunca emite URL para sha já `ready` + `finalize` só apaga `pending` |
| Bucket público por engano | driver nunca envia ACL/política; bucket deve ser criado privado (conferir no painel) |
| XSS/HTML ativo dentro do deck | `deck-lint` (segunda camada) + o editor sanitiza ao abrir |
| Banco inchado por imagem em base64 | `imagem_nao_externalizada` (> 64 KB) |
| Vazar segredo | nenhum erro/objeto expõe credencial; chaves S3 só no servidor |

---

## 9. Testes

```bash
cd platform
node --test --test-concurrency=1 "tests/unit/{canonical,deck-lint,asset-validate,storage-local,storage-s3}.test.js"
```

- `storage-s3.test.js` sobe um **moto** real (`python3 -m moto.server -p 4102`, `pip install "moto[server]"`) e o encerra no fim; sem moto, a suíte é marcada **SKIP com o motivo** (nunca simulada). Moto **não** valida assinaturas nem aplica o checksum: o que ele não prova (recusa do provedor a bytes errados, expiração real da URL) está coberto por `verify()` e deve ser conferido uma vez contra o provedor real (staging) — veja *Pendências*.
- Fixtures são geradas por código em `tests/fixtures/` (`make.js`, `generate.py` com python-pptx, `xss-corpus.js`, `deck.js`); nenhum binário versionado.
- **Preservação com decks reais.** `tests/fixtures/real-decks.json` (193 KB, texto) foi gerado pelo **editor de verdade** (`node tests/fixtures/extract-real-decks.mjs`, Chromium headless, só leitura de `studio/`): os 6 projetos prontos da capa e um deck com **137 slides cobrindo os 49 componentes (até 3 variantes) e os 18 layouts**, com as imagens trocadas por `asset:sha256:…` como o cliente da nuvem fará. `lintDeck` aceita todos (e `canonicalize`/`contentHash` são estáveis sob reordenação de chaves). Sem externalizar, o projeto institucional (imagens de 64–124 KB) é recusado com `imagem_nao_externalizada`, como pretendido. Conferência pontual (fora da suíte, para não versionar binários): as 7 imagens distintas desses decks (4 PNG de logo A&M e 3 JPEG 1280×720 da apresentação institucional) passam em `validateUpload`.
- Os testes de ataque foram validados por **mutação**: ao remover cada defesa (decodificação em camadas, tokenizador, CRC, fim do arquivo, razão de compressão, soma de 1 GiB, EOCD, `O_NOFOLLOW`, ACL, checksum, clamp de TTL…) pelo menos um teste falha. Duas defesas são redundantes de propósito (limite de pixels no IHDR *e* no `sharp`; `TAG_DENY` *e* o tokenizador).

## 10. Pendências e limites conhecidos

- **Upload direto exige CORS no endpoint do bucket** (o navegador faz `PUT` cross-origin com `Content-Type` e `x-amz-checksum-sha256`). A pesquisa indica que o Supabase **não** suporta CORS de bucket no endpoint S3; confirme em staging. Alternativas: R2/AWS (CORS configurável), upload resumível (TUS) do Supabase, ou limitar a `mode:'api'` (≤ 4 MB).
- `config.js` ainda não lê `S3_CHECKSUM` (`auto|off`); o driver aceita `storage.s3.checksum` mas hoje fica sempre `auto`.
- `moto` não valida SigV4 nem o checksum; testar contra o provedor real em staging (um `PUT` com bytes errados deve ser recusado; uma URL vencida deve falhar).
- PDF: não analisamos `/JavaScript` nem `/Launch` (o arquivo é servido só como download, `attachment`, com `nosniff`).
- Animação (WebP/GIF) só tem os quadros contados; apenas o 1º é decodificado.
- `lintDeck` é síncrono (≈ 1 s no pior caso de 12 MB).
- Arquivos `.tmp-*` do driver local deixados por queda do processo não são limpos automaticamente.
