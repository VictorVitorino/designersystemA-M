/* deps.js — monta as dependências (banco, armazenamento, GoTrue) a partir da config. Único lugar com `new` de serviços. */
import { createDb } from './db.js';
import { createStorage } from './storage/index.js';
import { createGoTrue } from './auth/gotrue.js';

export function buildDeps(config) {
  const ssl = config.db.ssl === 'require' ? 'require' : undefined;
  const db = createDb({ url: config.db.url, max: config.db.max, ssl });
  const storage = createStorage(config);
  const gotrue = createGoTrue(config);
  return { config, db, storage, gotrue };
}
