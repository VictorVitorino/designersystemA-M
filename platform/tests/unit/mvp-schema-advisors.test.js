import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../db/migrations/0008_function_search_path.sql', import.meta.url), 'utf8');

test('migração fixa search_path nas seis funções sinalizadas pelo advisor do Supabase', () => {
  for (const fn of [
    'current_user_id', 'trg_audit_append_only', 'trg_comments_guard',
    'trg_interactions_guard', 'trg_presentations_guard', 'trg_users_guard'
  ]) {
    assert.ok(source.includes('alter function app.' + fn + '() set search_path = pg_catalog, app;'), fn);
  }
});

test('migração de segurança não expõe funções, não revoga RLS nem altera dados', () => {
  assert.doesNotMatch(source, /\b(?:drop|delete|truncate|insert|update|disable row level security)\b/i);
  assert.doesNotMatch(source, /\b(?:grant execute|to public|security definer)\b/i);
});
