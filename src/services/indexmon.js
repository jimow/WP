// Index monitoring — records what we've submitted to Google's Indexing API and
// what Search Console reports is actually indexed (via URL Inspection), so the
// owner can see coverage for everything the 24/7 engine publishes.
import db from '../db.js';
import cfg from '../config.js';
import log from '../log.js';
import gsc from '../clients/gsc.js';
import indexing from '../clients/indexing.js';

const upsertSubmit = db.prepare(`
  INSERT INTO index_status(url, submitted_at) VALUES(?, datetime('now'))
  ON CONFLICT(url) DO UPDATE SET submitted_at=datetime('now')
`);
const upsertCheck = db.prepare(`
  INSERT INTO index_status(url, verdict, coverage, last_crawl, checked_at)
  VALUES(@url, @verdict, @coverage, @last_crawl, datetime('now'))
  ON CONFLICT(url) DO UPDATE SET
    verdict=excluded.verdict, coverage=excluded.coverage,
    last_crawl=excluded.last_crawl, checked_at=datetime('now')
`);

// Ping the Indexing API for a freshly published/updated URL (best-effort).
export async function submit(url) {
  if (!url || !cfg.getBool('indexing_enabled') || !indexing.configured()) return { ok: false, skipped: true };
  try {
    await indexing.publishUrl(url, 'URL_UPDATED');
    upsertSubmit.run(url);
    log.info('indexmon', `Submitted to Indexing API: ${url}`);
    return { ok: true };
  } catch (e) {
    log.warn('indexmon', `Indexing submit failed for ${url}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Check one URL's coverage via Search Console URL Inspection and store it.
export async function check(url) {
  if (!gsc.configured()) throw new Error('Connect Search Console first.');
  const r = await gsc.inspectUrl(url);
  upsertCheck.run({ url, verdict: r.verdict || null, coverage: r.coverageState || null, last_crawl: r.lastCrawlTime || null });
  return { url, ...r };
}

// Inspect recently published posts that we haven't checked lately (rate-limited
// by GSC quota — keep `limit` small per run).
export async function monitorRecent(limit = 5) {
  if (!gsc.configured()) return { checked: 0 };
  const urls = db.prepare(`
    SELECT a.wp_url url FROM articles a
    WHERE a.status='published' AND a.wp_url IS NOT NULL
      AND a.wp_url NOT IN (SELECT url FROM index_status WHERE checked_at > datetime('now','-3 day'))
    ORDER BY a.published_at DESC LIMIT ?
  `).all(limit).map((r) => r.url);
  let checked = 0;
  for (const url of urls) {
    try { await check(url); checked++; } catch (e) { log.warn('indexmon', `inspect ${url}: ${e.message}`); }
  }
  return { checked };
}

export function list() {
  return db.prepare('SELECT * FROM index_status ORDER BY COALESCE(checked_at, submitted_at) DESC LIMIT 200').all();
}

export function summary() {
  const rows = db.prepare('SELECT verdict, COUNT(*) n FROM index_status GROUP BY verdict').all();
  const submitted = db.prepare('SELECT COUNT(*) n FROM index_status WHERE submitted_at IS NOT NULL').get().n;
  const indexed = db.prepare("SELECT COUNT(*) n FROM index_status WHERE verdict='PASS'").get().n;
  return { submitted, indexed, byVerdict: rows, configured: indexing.configured(), enabled: cfg.getBool('indexing_enabled') };
}

export default { submit, check, monitorRecent, list, summary };
