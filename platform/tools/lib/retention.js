/* tools/lib/retention.js — retenção GFS (avô-pai-filho) de backups: 14 diários, 8 semanais, 12 mensais (ajustáveis).
   Função PURA (sem I/O): recebe a lista [{name, at:Date}] e devolve o que manter/apagar. Sempre mantém o backup mais recente e nunca
   apaga se isso deixaria menos de `minKeep` backups. A poda de verdade (backup.js prune --apply) só apaga o que este plano manda. */
const dayKey = (d) => d.toISOString().slice(0, 10);
function isoWeekKey(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dow);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); const w = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}
const monthKey = (d) => d.toISOString().slice(0, 7);

export function gfsPlan(entries, { now = new Date(), daily = 14, weekly = 8, monthly = 12, minKeep = 3 } = {}) {
  const sorted = [...entries].sort((a, b) => b.at - a.at); // mais novo primeiro
  const keep = new Map(); // name → razões
  const mark = (e, why) => { if (!keep.has(e.name)) keep.set(e.name, new Set()); keep.get(e.name).add(why); };
  const pick = (keyFn, n, why) => {
    const seen = new Set();
    for (const e of sorted) { const k = keyFn(e.at); if (seen.has(k)) continue; if (seen.size >= n) break; seen.add(k); mark(e, why); }
  };
  if (sorted.length) mark(sorted[0], 'mais-recente');
  // “diário” = o último backup de cada um dos últimos N dias que TÊM backup (dias sem backup não consomem a cota)
  pick(dayKey, daily, 'diario'); pick(isoWeekKey, weekly, 'semanal'); pick(monthKey, monthly, 'mensal');
  // reforço de segurança: se o plano apagaria demais, mantém os mais novos até chegar em minKeep
  for (const e of sorted) { if (keep.size >= minKeep) break; mark(e, 'minimo'); }
  const kept = sorted.filter((e) => keep.has(e.name)).map((e) => ({ ...e, why: [...keep.get(e.name)] }));
  const remove = sorted.filter((e) => !keep.has(e.name));
  return { keep: kept, remove, summary: { total: sorted.length, keep: kept.length, remove: remove.length } };
}
