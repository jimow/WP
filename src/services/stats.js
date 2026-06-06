// Content statistics: how much was created/published over various periods, and
// per-URL performance (clicks/impressions/position) merged from Search Console.
import db from '../db.js';
import gsc from '../clients/gsc.js';

const PERIODS = [
  ['today', "date({col}) = date('now')"],
  ['d7', "{col} >= datetime('now','-7 days')"],
  ['d30', "{col} >= datetime('now','-30 days')"],
  ['d90', "{col} >= datetime('now','-90 days')"],
  ['all', '1=1'],
];

function periodCounts(table, col, extra) {
  const out = {};
  for (const [key, cond] of PERIODS) {
    const where = [cond.replace(/{col}/g, col)];
    if (extra) where.push(extra);
    out[key] = db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where.join(' AND ')}`).get().n;
  }
  return out;
}

function byStatus(table) {
  return db.prepare(`SELECT status, COUNT(*) n FROM ${table} GROUP BY status`).all()
    .reduce((a, r) => ((a[r.status] = r.n), a), {});
}

// Published-per-day for the last N days (for a sparkline/trend).
function publishedSeries(table, days = 30) {
  const rows = db.prepare(
    `SELECT date(published_at) d, COUNT(*) n FROM ${table}
     WHERE published_at >= datetime('now', ?) GROUP BY date(published_at)`
  ).all(`-${days} days`);
  const map = rows.reduce((a, r) => ((a[r.d] = r.n), a), {});
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: key, count: map[key] || 0 });
  }
  return series;
}

export function summary() {
  return {
    articles: {
      total: db.prepare('SELECT COUNT(*) n FROM articles').get().n,
      byStatus: byStatus('articles'),
      created: periodCounts('articles', 'created_at'),
      published: periodCounts('articles', 'published_at', "status='published'"),
      series: publishedSeries('articles', 30),
    },
    pages: {
      total: db.prepare('SELECT COUNT(*) n FROM pages').get().n,
      byStatus: byStatus('pages'),
      created: periodCounts('pages', 'created_at'),
      published: periodCounts('pages', 'published_at', "status='published'"),
      series: publishedSeries('pages', 30),
    },
    keywords: db.prepare('SELECT COUNT(*) n FROM keywords').get().n,
    clusters: db.prepare('SELECT COUNT(*) n FROM clusters').get().n,
  };
}

const normUrl = (u) => (u || '').trim().toLowerCase().replace(/\/+$/, '');

// Published articles + pages, each annotated with GSC traffic for the window
// (if Search Console is connected). days defaults to 28.
export async function performance(days = 28) {
  const articles = db.prepare(
    "SELECT id, title, wp_url, role, published_at FROM articles WHERE status='published' AND wp_url IS NOT NULL ORDER BY published_at DESC"
  ).all();
  const pages = db.prepare(
    "SELECT id, title, wp_url, published_at FROM pages WHERE status='published' AND wp_url IS NOT NULL ORDER BY published_at DESC"
  ).all();

  let gscMap = null;
  let gscError = null;
  if (gsc.configured()) {
    try {
      const end = new Date(); end.setDate(end.getDate() - 2);
      const start = new Date(end); start.setDate(start.getDate() - days);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const rows = await gsc.query({ startDate: fmt(start), endDate: fmt(end), dimensions: ['page'], rowLimit: 1000 });
      gscMap = {};
      for (const r of rows) {
        gscMap[normUrl(r.keys[0])] = {
          clicks: r.clicks, impressions: r.impressions,
          ctr: r.ctr, position: Math.round(r.position * 10) / 10,
        };
      }
    } catch (e) { gscError = e.message; }
  }

  const annotate = (item) => ({ ...item, gsc: gscMap ? gscMap[normUrl(item.wp_url)] || null : null });
  return {
    gscConnected: gsc.configured(),
    gscError,
    window: { days },
    articles: articles.map(annotate),
    pages: pages.map(annotate),
  };
}

export default { summary, performance };
