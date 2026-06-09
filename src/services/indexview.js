// Index & performance overview for the SITE's existing pages — built on REAL
// Google data, not guesses:
//   • performance (clicks/impressions/CTR/position) comes LIVE from Search
//     Console for the chosen date range (7d / 28d / 3mo / 6mo / 12mo / 16mo),
//     so the numbers match GSC exactly;
//   • index status comes from GSC URL Inspection verdicts (index_status) AND the
//     hard signal that a page WITH impressions is, by definition, indexed.
// A page is INDEXED only if URL-Inspection says PASS or it has real impressions.
// NOT-INDEXED only if URL-Inspection returned NEUTRAL/FAIL. Everything else is
// UNCHECKED (offer a live check) — never silently guessed.
import db from '../db.js';
import cfg from '../config.js';
import gsc from '../clients/gsc.js';

const round = (n) => (n == null ? null : Math.round(n * 10) / 10);

// Canonical page URL — drop the #fragment so anchor/jump-link variants that GSC
// reports separately (…/page/#section) collapse into the ONE real page.
function canonUrl(url) {
  try { const u = new URL(url); u.hash = ''; return u.toString(); }
  catch { return String(url || '').split('#')[0]; }
}

export const RANGES = [
  { id: '7d', label: '7 days', days: 7 },
  { id: '28d', label: '28 days', days: 28 },
  { id: '3m', label: '3 months', days: 90 },
  { id: '6m', label: '6 months', days: 180 },
  { id: '12m', label: '12 months', days: 365 },
  { id: '16m', label: '16 months', days: 480 },
];

function dateWindow(days) {
  const end = new Date(); end.setDate(end.getDate() - 2); // GSC data lags ~2 days
  const start = new Date(end); start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

function titleFromUrl(url) {
  try { const s = new URL(url).pathname.replace(/\/+$/, '').split('/').pop() || url; return s.replace(/[-_]/g, ' ').trim() || url; }
  catch { return url; }
}

function perfSinceOptimized(url, appliedAt) {
  if (!appliedAt) return null;
  const day = String(appliedAt).slice(0, 10);
  const before = db.prepare('SELECT position, date FROM rank_snapshots WHERE url=? AND date<=? ORDER BY date DESC LIMIT 1').get(url, day);
  const after = db.prepare('SELECT position, date FROM rank_snapshots WHERE url=? AND date>? ORDER BY date DESC LIMIT 1').get(url, day);
  if (!before || !after) return null;
  return { beforePos: before.position, afterPos: after.position, delta: round(before.position - after.position), from: before.date, to: after.date };
}

export async function overview({ range = '28d' } = {}) {
  const r = RANGES.find((x) => x.id === range) || RANGES[1];
  const base = {
    range: r.id, ranges: RANGES.map((x) => ({ id: x.id, label: x.label })),
    gscConnected: gsc.configured(),
    counts: { indexed: 0, notIndexed: 0, unchecked: 0 }, easyWins: 0,
    totals: { clicks: 0, impressions: 0 },
    indexed: [], notIndexed: [], unchecked: [],
  };
  if (!gsc.configured()) return { ...base, needsGsc: true };

  // 1) LIVE GSC performance per page for the range (authoritative numbers).
  const { startDate, endDate } = dateWindow(r.days);
  let pages = [];
  try { pages = await gsc.query({ startDate, endDate, dimensions: ['page'], rowLimit: 1000 }); }
  catch (e) {
    const needsReauth = /expired|revoked|invalid_grant|token refresh failed|unauthorized|401/i.test(e.message);
    return { ...base, error: e.message, needsReauth };
  }
  // Aggregate by CANONICAL url (merge …/page/ and …/page/#anchor into one).
  const perf = {};
  for (const row of pages) {
    const url = canonUrl(row.keys[0]);
    const a = perf[url] || (perf[url] = { clicks: 0, impressions: 0, _pw: 0 });
    a.clicks += row.clicks || 0;
    a.impressions += row.impressions || 0;
    a._pw += (row.position || 0) * (row.impressions || 0); // impression-weighted position (how GSC blends)
  }
  for (const url of Object.keys(perf)) {
    const a = perf[url];
    a.ctr = a.impressions ? a.clicks / a.impressions : 0;
    a.position = a.impressions ? round(a._pw / a.impressions) : null;
    delete a._pw;
  }

  // 2) Real index verdicts (URL Inspection results we've stored) + titles + opts.
  const idx = {};
  for (const row of db.prepare('SELECT * FROM index_status').all()) idx[canonUrl(row.url)] = row;
  const titleByUrl = {};
  for (const a of db.prepare('SELECT wp_url, title, focus_keyword, keyword FROM articles WHERE wp_url IS NOT NULL').all()) titleByUrl[canonUrl(a.wp_url)] = { title: a.title, kw: a.focus_keyword || a.keyword };
  const opts = {};
  for (const o of db.prepare("SELECT target_url, type, status, applied_at, created_at FROM optimizations WHERE target_url IS NOT NULL ORDER BY COALESCE(applied_at, created_at) DESC").all()) { const u = canonUrl(o.target_url); if (!opts[u]) opts[u] = o; }

  const posMin = cfg.getInt('opt_pos_min', 8), posMax = cfg.getInt('opt_pos_max', 20), minImpr = cfg.getInt('opt_min_impressions', 30);

  const urls = new Set([...Object.keys(perf), ...Object.keys(idx), ...Object.keys(titleByUrl)]);
  const indexed = [], notIndexed = [], unchecked = [];
  let totalClicks = 0, totalImpr = 0;

  for (const url of urls) {
    const p = perf[url], ix = idx[url], meta = titleByUrl[url] || {}, op = opts[url];
    const impressions = p?.impressions || 0;
    totalClicks += p?.clicks || 0; totalImpr += impressions;
    const verdict = ix?.verdict || null;
    const isIndexed = verdict === 'PASS' || impressions > 0; // impressions ⇒ Google has indexed it
    const isNotIndexed = !isIndexed && (verdict === 'NEUTRAL' || verdict === 'FAIL');
    const optimization = op ? { type: op.type, status: op.status, appliedAt: op.applied_at, createdAt: op.created_at, movement: op.status === 'applied' ? perfSinceOptimized(url, op.applied_at || op.created_at) : null } : null;
    const row = {
      url, title: meta.title || titleFromUrl(url), focusKeyword: meta.kw || null,
      clicks: p?.clicks ?? null, impressions: p?.impressions ?? null, ctr: p?.ctr ?? null, position: p?.position ?? null,
      verdict, coverage: ix?.coverage || null, checkedAt: ix?.checked_at || null,
      indexState: verdict === 'PASS' ? 'Indexed (verified)' : impressions > 0 ? 'Indexed (receiving impressions)' : verdict ? `Not indexed — ${ix.coverage || verdict}` : 'Not checked',
      optimization,
      searchUrl: `https://www.google.com/search?q=${encodeURIComponent('site:' + url)}`,
      inspectUrl: cfg.get('gsc_site_url') ? `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(cfg.get('gsc_site_url'))}&id=${encodeURIComponent(url)}` : '',
    };
    if (isIndexed) {
      row.easyOptimize = !!(p && p.position != null && p.position >= posMin && p.position <= posMax && impressions >= minImpr);
      indexed.push(row);
    } else if (isNotIndexed) {
      notIndexed.push(row);
    } else {
      unchecked.push(row);
    }
  }
  indexed.sort((a, b) => (Number(b.easyOptimize) - Number(a.easyOptimize)) || ((b.clicks || 0) - (a.clicks || 0)) || ((b.impressions || 0) - (a.impressions || 0)));
  notIndexed.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  unchecked.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  return {
    ...base,
    counts: { indexed: indexed.length, notIndexed: notIndexed.length, unchecked: unchecked.length },
    easyWins: indexed.filter((x) => x.easyOptimize).length,
    totals: { clicks: totalClicks, impressions: totalImpr },
    optimized: indexed.concat(notIndexed).filter((x) => x.optimization && x.optimization.status === 'applied'),
    indexed, notIndexed, unchecked,
  };
}

export default { overview, RANGES };
