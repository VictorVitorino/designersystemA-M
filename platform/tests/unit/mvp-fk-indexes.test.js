import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../../db/migrations/0009_fk_lookup_indexes.sql', import.meta.url), 'utf8');
const wanted = [
  ['asset_uploads', 'user_id'],
  ['comments', 'author_id'],
  ['comments', 'resolved_by'],
  ['invites', 'invited_by'],
  ['invites', 'user_id'],
  ['presentation_versions', 'created_by'],
  ['presentations', 'deleted_by'],
  ['presentations', 'updated_by'],
  ['settings', 'updated_by'],
  ['users', 'invited_by'],
];

test('migração 0009: as 10 foreign keys apontadas pelo advisor ficam cobertas por índice B-tree', () => {
  const ddl = [...sql.matchAll(/create\s+index\s+if\s+not\s+exists\s+([a-z0-9_]+)\s+on\s+app\.([a-z0-9_]+)\s*\(\s*([a-z0-9_]+)\s*\)\s*;/gi)];
  assert.equal(ddl.length, wanted.length);
  const got = ddl.map(x => x[2] + '.' + x[3]).sort();
  assert.deepEqual(got, wanted.map(([table,column]) => table + '.' + column).sort());
  assert.equal(new Set(ddl.map(x => x[1])).size, wanted.length, 'nomes de índices distintos');
});

test('migração 0009: não apaga dados, não altera permissões e preserva RLS', () => {
  const statements = sql.replace(/--[^\n]*/g, '').split(';').map(x => x.trim()).filter(Boolean);
  assert.equal(statements.length, 10);
  for (const statement of statements) {
    assert.match(statement, /^create\s+index\s+if\s+not\s+exists\s+[a-z0-9_]+\s+on\s+app\.[a-z0-9_]+\s*\(\s*[a-z0-9_]+\s*\)$/i);
  }
});
