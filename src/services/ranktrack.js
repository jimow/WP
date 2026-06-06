// Rank tracking — persists a daily snapshot of every page's Search Console
// position so we can see TRENDS (not just a live number) and detect decay. When
// a page slips beyond the owner's threshold, the pipeline auto-queues a refresh.
import db from '../db.js';
import cfg from '../config.js';
import log from '../log.js';
import gsc from '../clients/gsc.js';

const round = (n) => Math.round(n * 10) / 10;
const today = () => new Date().toISOString().slice(0, 10);

function window(days = 28) {
  const end = new Date(); end.setDate(end.getDate() - 2);
  const start = new Date(end); start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

const upsert = db.prepare(`
  INSERT INTO rank_snapshots(date, url, position, impressions, clicks, ctr)
  VALUES(@date, @url, @position, @impressions, @clicks, @ctr)
  ON CONFLICT(date, url) DO UPDATE SET
    position=excluded.position, impressions=excluded.impressions,
    clicks=excluded.clicks, ctr=excluded.ctr, captured_at=datetime('now')
`);

export function hasSnapshotToday() {
  return !!db.prepare("SELECT 1 FROM rank_snapshots WHERE date=? LIMIT 1").get(today());
}

// Take one daily snapshot of the top pages by impressions.
export async function snapshot({ force = false } = {}) {
  if (!gsc.configured()) throw new Error('Connect Search Console first.');
  if (!force && hasSnapshotToday()) return { date: today(), rows: 0, skipped: 'already snapshotted today' };
  const { startDate, endDate } = window(cfg.getInt('rank_window_days', 28));
  const rows = await gsc.query({ startDate, endDate, dimensions: ['page'], rowLimit: 500 });
  const date = today();
  const tx = db.transaction((items) => {
    for (const r of items) {
      upsert.run({ date, url: r.keys[0], position: round(r.position), impressions: r.impressions, clicks: r.clicks, ctr: r.ctr });
    }
  });
  tx(rows);
  log.info('ranktrack', `Snapshot ${date}: ${rows.length} pages`);
  return { date, rows: rows.length };
}

// Compare the latest snapshot for each URL against the oldest snapshot within
// `lookback` days. delta > 0 means the position number GREW = ranking got WORSE.
export function trends({ lookback = 30, minImpressions = 10 } = {}) {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - lookback);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const urls = db.prepare(
    "SELECT DISTINCT url FROM rank_snapshots WHERE date >= ?"
  ).all(cutoffStr).map((r) => r.url);

  const out = [];
  for (const url of urls) {
    const latest = db.prepare(
      "SELECT * FROM rank_snapshots WHERE url=? ORDER BY date DESC LIMIT 1"
    ).get(url);
    const base = db.prepare(
      "SELECT * FROM rank_snapshots WHERE url=? AND date >= ? ORDER BY date ASC LIMIT 1"
    ).get(url, cutoffStr);
    if (!latest || !base || latest.date === base.date) continue;
    if ((latest.impressions || 0) < minImpressions) continue;
    const delta = round(latest.position - base.position); // + = worse
    out.push({
      url, from: base.date, to: latest.date,
      positionFrom: base.position, positionTo: latest.position,
      delta, impressions: latest.impressions, clicks: latest.clicks,
      direction: delta > 0.3 ? 'down' : delta < -0.3 ? 'up' : 'flat',
    });
  }
  out.sort((a, b) => b.delta - a.delta); // biggest decliners first
  return out;
}

// Pages that have slipped enough to warrant an auto-refresh.
export function decliners() {
  const threshold = parseFloat(cfg.get('rank_decline_threshold')) || 3;
  const minImpr = cfg.getInt('opt_min_impressions', 30);
  return trends({ lookback: cfg.getInt('rank_window_days', 28), minImpressions: minImpr })
    .filter((t) => t.delta >= threshold && t.positionTo <= 40);
}

// Lightweight summary for the dashboard.
export function summary() {
  const days = db.prepare("SELECT COUNT(DISTINCT date) n FROM rank_snapshots").get().n;
  const tracked = db.prepare("SELECT COUNT(DISTINCT url) n FROM rank_snapshots").get().n;
  const t = trends({});
  return {
    snapshotDays: days, trackedUrls: tracked, hasToday: hasSnapshotToday(),
    decliners: t.filter((x) => x.direction === 'down').length,
    improvers: t.filter((x) => x.direction === 'up').length,
  };
}

export default { snapshot, hasSnapshotToday, trends, decliners, summary };
