/* Fábrica do armazenamento de objetos. A interface (idêntica nos dois drivers) está documentada em docs/arquivos-e-armazenamento.md:
     put(sha, bytes, {mime}) · get(sha) · getStream(sha) · head(sha) · delete(sha) · signedGetUrl(sha, opts) · createUpload(sha, opts)
     verify(sha) · list({prefix, limit, cursor}) · ping()
   Toda chave de objeto sai de objectKey(sha) (keys.js): nenhuma entrada do cliente vira caminho. */
import { createLocalStorage } from './local.js';
import { createS3Storage } from './s3.js';

export * from './keys.js';
export { createLocalStorage, createS3Storage };

/**
 * @typedef {object} ObjectStorage  Interface idêntica nos drivers local e s3. `sha` é SEMPRE 64 hex minúsculos (senão lança StorageKeyError).
 * @property {'local'|'s3'} driver
 * @property {(sha:string, bytes:Buffer|Uint8Array, opts:{mime:string, verify?:boolean}) => Promise<{created:boolean, size:number}>} put  idempotente; confere sha256(bytes)===sha (verify:false desliga, só para quem acabou de calcular)
 * @property {(sha:string) => Promise<{body:Buffer, size:number}|null>} get
 * @property {(sha:string) => Promise<{stream:ReadableStream, size:number}|null>} getStream  stream Web; quem pede precisa consumir ou cancelar
 * @property {(sha:string) => Promise<{size:number}|null>} head
 * @property {(sha:string) => Promise<{deleted:boolean}>} delete
 * @property {(sha:string, opts?:{ttlS?:number, filename?:string, disposition?:'attachment'|'inline', mime?:string}) => Promise<string|null>} signedGetUrl  null no driver local; padrão attachment; ttl ≤ 3600
 * @property {(sha:string, opts:{size:number, mime:string, ttlS?:number}) => Promise<{url:string, method:'PUT', headers:Record<string,string>, expiresAt:string}|null>} createUpload  null no driver local
 * @property {(sha:string) => Promise<{ok:boolean, size:number|null, actualSha:string|null}>} verify  relê o objeto e confere o hash
 * @property {(opts?:{prefix?:string, limit?:number, cursor?:string}) => Promise<{keys:string[], items:{sha:string,key:string,size:number,lastModified:Date}[], next:string|null}>} list  prefix = prefixo hex de sha; cursor = último sha da página anterior
 * @property {() => Promise<boolean>} ping  para /api/ready
 */
/** @param {{storage:{driver:'local'|'s3', localDir?:string, s3?:object}}} config
 *  @returns {ObjectStorage} */
export function createStorage(config) {
  const st = config && config.storage;
  if (!st) throw new Error('storage: config.storage ausente');
  if (st.driver === 'local') return createLocalStorage(st.localDir);
  if (st.driver === 's3') return createS3Storage(st.s3 || {});
  throw new Error(`storage: driver desconhecido "${String(st.driver).slice(0, 20)}"`);
}
