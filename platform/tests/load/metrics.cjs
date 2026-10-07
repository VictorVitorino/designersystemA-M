/* tests/load/metrics.cjs — medições do teste de carga: latência por endpoint (p50/p95/p99), contagem por status, linha do tempo e
   amostrador do sistema (conexões do Postgres via pg_stat_activity, memória/CPU do processo da API lidas de /proc).
   Nada aqui toca a API: só agrega números que client.cjs/scenario.cjs registram. */
'use strict';
const fs = require('node:fs');

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Classe de uma resposta para a tabela de erros. `expect` = status que a sonda esperava (403/404/409). */
function classify(status, expect) {
  if (status === 0) return 'rede';
  if (expect && status === expect) return 'esperado';
  if (status >= 200 && status < 400) return 'ok';
  if (status === 429) return '429';
  if (status >= 500) return '5xx';
  return '4xx';
}

class Metrics {
  constructor() { this.reset(); }
  reset() { this.byKey = new Map(); this.timeline = []; this.t0 = Date.now(); this.t1 = null; }
  start() { this.t0 = Date.now(); }
  stop() { this.t1 = Date.now(); }
  /** @param {{key:string, ms:number, status:number, expect?:number, bytes?:number, at?:number}} r */
  record(r) {
    let e = this.byKey.get(r.key);
    if (!e) { e = { key: r.key, lat: [], latOk: [], statuses: new Map(), classes: { ok: 0, esperado: 0, '429': 0, '4xx': 0, '5xx': 0, rede: 0 }, bytes: 0, n: 0 }; this.byKey.set(r.key, e); }
    e.n++; e.lat.push(r.ms); e.bytes += r.bytes || 0;
    if (r.status >= 200 && r.status < 400) e.latOk.push(r.ms);
    e.statuses.set(r.status, (e.statuses.get(r.status) || 0) + 1);
    e.classes[classify(r.status, r.expect)]++;
    this.timeline.push([r.at || Date.now(), r.key, r.ms, r.status]);
  }
  durationS() { return ((this.t1 || Date.now()) - this.t0) / 1000; }
  /** Tabela por endpoint. */
  summary() {
    const dur = this.durationS();
    const rows = [];
    for (const e of [...this.byKey.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      const s = [...e.lat].sort((a, b) => a - b); const ok = [...e.latOk].sort((a, b) => a - b);
      rows.push({
        key: e.key, n: e.n, rps: round(e.n / dur, 2), p50: round(percentile(s, 50)), p95: round(percentile(s, 95)), p99: round(percentile(s, 99)), max: round(s[s.length - 1]), mean: round(s.reduce((a, b) => a + b, 0) / s.length),
        nOk: ok.length, p50ok: round(percentile(ok, 50)), p95ok: round(percentile(ok, 95)), p99ok: round(percentile(ok, 99)),
        statuses: Object.fromEntries([...e.statuses.entries()].sort((a, b) => a[0] - b[0])), classes: { ...e.classes }, mbTransferred: round(e.bytes / 1048576, 2),
      });
    }
    const total = rows.reduce((a, r) => a + r.n, 0);
    const all = this.timeline.map((t) => t[2]).sort((a, b) => a - b);
    return { durationS: round(dur), total, rps: round(total / dur, 2), p50: round(percentile(all, 50)), p95: round(percentile(all, 95)), p99: round(percentile(all, 99)), rows };
  }
  /** Linha do tempo em janelas de `stepS` segundos: req/s total, p95 do PUT /content, 5xx e 429. */
  windows(stepS = 10, putKey = 'PUT /api/presentations/:id/content') {
    const out = [];
    const end = this.t1 || Date.now();
    for (let ws = this.t0; ws < end; ws += stepS * 1000) {
      const we = ws + stepS * 1000;
      const items = this.timeline.filter((t) => t[0] >= ws && t[0] < we);
      const put = items.filter((t) => t[1] === putKey && t[3] === 200).map((t) => t[2]).sort((a, b) => a - b);
      const get = items.filter((t) => t[1].startsWith('GET ') && t[3] < 400).map((t) => t[2]).sort((a, b) => a - b);
      out.push({ fromS: Math.round((ws - this.t0) / 1000), n: items.length, rps: round(items.length / stepS, 1), putN: put.length, putP95: round(percentile(put, 95)), getP95: round(percentile(get, 95)), e5xx: items.filter((t) => t[3] >= 500).length, e429: items.filter((t) => t[3] === 429).length, rede: items.filter((t) => t[3] === 0).length });
    }
    return out;
  }
}

/* ───────────── sistema: Postgres + processo da API ───────────── */

function readProc(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = Number((/VmRSS:\s+(\d+)/.exec(status) || [])[1] || 0) * 1024;
    const hwm = Number((/VmHWM:\s+(\d+)/.exec(status) || [])[1] || 0) * 1024;
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(after[11]) + Number(after[12]);   // utime + stime (campos 14 e 15 do /proc/pid/stat)
    const threads = Number(after[17]);
    return { rss, hwm, ticks, threads };
  } catch { return null; }
}

/** Amostra o Postgres (conexões do banco do teste) e o processo da API a cada `everyMs`. `sql` = conexão administrativa (postgres.js). */
class SystemSampler {
  constructor({ sql, dbName, pid, everyMs = 2000 }) { this.sql = sql; this.dbName = dbName; this.pid = pid; this.everyMs = everyMs; this.samples = []; this.timer = null; this.prev = null; this.clk = 100; }
  async sampleOnce() {
    const at = Date.now();
    let pg = null;
    try {
      const rows = await this.sql`select coalesce(state, 'none') as state, coalesce(wait_event_type, '') as wait, count(*)::int as n
          from pg_stat_activity where datname = ${this.dbName} and usename = 'app_api' and pid <> pg_backend_pid() group by 1, 2`;   // só as conexões da API (o medidor usa outro papel)
      pg = { total: 0, active: 0, idle: 0, idleInTx: 0, waitingLock: 0, waitingIO: 0 };
      for (const r of rows) {
        pg.total += r.n;
        if (r.state === 'active') pg.active += r.n;
        if (r.state === 'idle') pg.idle += r.n;
        if (r.state.startsWith('idle in transaction')) pg.idleInTx += r.n;
        if (r.wait === 'Lock') pg.waitingLock += r.n;
        if (r.wait === 'IO') pg.waitingIO += r.n;
      }
    } catch (e) { pg = { error: String(e.message) }; }
    const proc = readProc(this.pid);
    let cpuPct = null;
    if (proc && this.prev) { const dt = (at - this.prev.at) / 1000; cpuPct = dt > 0 ? ((proc.ticks - this.prev.ticks) / this.clk) / dt * 100 : null; }
    this.prev = proc ? { at, ticks: proc.ticks } : this.prev;
    this.samples.push({ at, pg, rss: proc ? proc.rss : null, hwm: proc ? proc.hwm : null, threads: proc ? proc.threads : null, cpuPct });
  }
  start() { this.stop(); this.samples = []; this.prev = null; this.timer = setInterval(() => { this.sampleOnce().catch(() => {}); }, this.everyMs); return this.sampleOnce(); }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  summary() {
    const s = this.samples.filter((x) => x.pg && !x.pg.error);
    const max = (f) => (s.length ? Math.max(...s.map(f)) : null);
    const avg = (f) => (s.length ? s.map(f).reduce((a, b) => a + b, 0) / s.length : null);
    const withRss = this.samples.filter((x) => x.rss);
    const cpu = this.samples.filter((x) => x.cpuPct != null).map((x) => x.cpuPct);
    return {
      samples: this.samples.length,
      pg: s.length ? { maxTotal: max((x) => x.pg.total), avgTotal: round(avg((x) => x.pg.total)), maxActive: max((x) => x.pg.active), avgActive: round(avg((x) => x.pg.active), 2), maxIdleInTx: max((x) => x.pg.idleInTx), maxWaitingLock: max((x) => x.pg.waitingLock), maxWaitingIO: max((x) => x.pg.waitingIO) } : null,
      rssMaxMb: withRss.length ? round(Math.max(...withRss.map((x) => x.rss)) / 1048576) : null,
      rssStartMb: withRss.length ? round(withRss[0].rss / 1048576) : null,
      rssEndMb: withRss.length ? round(withRss[withRss.length - 1].rss / 1048576) : null,
      hwmMb: withRss.length ? round(Math.max(...withRss.map((x) => x.hwm)) / 1048576) : null,
      cpuAvgPct: cpu.length ? round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null,
      cpuMaxPct: cpu.length ? round(Math.max(...cpu)) : null,
      threadsMax: this.samples.filter((x) => x.threads).length ? Math.max(...this.samples.filter((x) => x.threads).map((x) => x.threads)) : null,
    };
  }
}

module.exports = { Metrics, SystemSampler, percentile, classify, round, readProc };
