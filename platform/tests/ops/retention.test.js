import test from 'node:test';
import assert from 'node:assert/strict';
import { gfsPlan } from '../../tools/lib/retention.js';

const day = (n, h = 5) => new Date(Date.UTC(2026, 9, 6, h, 15) - n * 86400e3);
const mk = (list) => list.map((d, i) => ({ name: `b${i}-${d.toISOString()}`, at: d }));

test('GFS: 400 dias de backups diários → mantém no máximo 14+8+12 e sempre o mais recente', () => {
  const entries = mk(Array.from({ length: 400 }, (_, i) => day(i)));
  const p = gfsPlan(entries, { now: day(0, 6) });
  assert.ok(p.keep.length <= 34 && p.keep.length >= 14, `manteve ${p.keep.length}`);
  assert.equal(p.keep.length + p.remove.length, 400);
  assert.equal(p.keep[0].name, entries[0].name); assert.ok(p.keep[0].why.includes('mais-recente'));
  const daily = p.keep.filter((e) => e.why.includes('diario')).length; assert.equal(daily, 14);
  assert.ok(p.keep.filter((e) => e.why.includes('semanal')).length >= 8);
  assert.ok(p.keep.filter((e) => e.why.includes('mensal')).length >= 12 - 1);
  // o mais antigo (400 dias) tem de ser removido
  assert.ok(p.remove.some((e) => e.name === entries[399].name));
});
test('GFS: vários backups no mesmo dia → fica só o último do dia (fora do mínimo)', () => {
  const entries = mk([day(0, 23), day(0, 12), day(0, 5), day(1, 23), day(1, 5)]);
  const p = gfsPlan(entries, { now: day(0, 23), minKeep: 1 });
  assert.deepEqual(p.keep.map((e) => e.name), [entries[0].name, entries[3].name]);
});
test('GFS: nunca apaga abaixo do mínimo e nunca devolve plano vazio quando há backups', () => {
  const entries = mk([day(0), day(300), day(301)]);
  const p = gfsPlan(entries, { now: day(0), daily: 1, weekly: 1, monthly: 1, minKeep: 3 });
  assert.equal(p.keep.length, 3); assert.equal(p.remove.length, 0);
  assert.equal(gfsPlan([], {}).keep.length, 0);
});
test('GFS: dias sem backup não consomem a cota diária', () => {
  const entries = mk([day(0), day(10), day(20), day(30)]);
  const p = gfsPlan(entries, { now: day(0), daily: 3, weekly: 0, monthly: 0, minKeep: 1 });
  assert.equal(p.keep.length, 3);
});
