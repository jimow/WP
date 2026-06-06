// Keyword index — every focus keyword already covered, so we never recreate one
// (avoids keyword cannibalisation). Sources:
//   • live published posts/pages (focus keyword derived from slug; real Rank Math
//     focus keyword if the SEO Bridge plugin is installed)
//   • our own articles (focus_keyword / keyword)
// Matching is exact (normalised) plus a fuzzy pass (stop-words removed, order-
// independent) so "transpose of a matrix" ≈ "matrix transpose".
import db from '../db.js';
import wp from '../clients/wp.js';
import cfg from '../config.js';
import log from '../log.js';

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'and', 'or', 'how', 'what', 'is', 'are', 'your', 'with', 'using', 'explained', 'guide', 'tutorial', 'vs']);

export function norm(s) {
  return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Light stemmer so singular/plural & common inflections collapse together.
const IRREGULAR = { matrices: 'matrix', indices: 'index', vertices: 'vertex', formulae: 'formula', radii: 'radius' };
const stem = (w) => IRREGULAR[w] || w.replace(/ies$/, 'y').replace(/(es|s)$/, '').replace(/(ing|ed|ion|er|ly)$/, '');
function fuzzyKey(s) {
  return norm(s).split(' ').filter((w) => w && !STOP.has(w)).sort().join(' ');
}
// Stemmed, stopword-stripped, order-independent key — for grouping near-duplicates.
export function simKey(s) {
  return norm(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem).sort().join(' ');
}
function simTokens(s) {
  return new Set(norm(s).split(' ').filter((w) => w && !STOP.has(w)).map(stem));
}
// Are two keywords "the same or similar" (would cannibalise each other)?
export function similar(a, b) {
  const A = simTokens(a), B = simTokens(b);
  if (!A.size || !B.size) return false;
  if (simKey(a) === simKey(b)) return true;                 // same after stem+sort
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return inter / union >= 0.6 || inter / Math.min(A.size, B.size) >= 0.85; // strong overlap / subset
}

export async function build() {
  const rows = [];
  if (cfg.get('wp_base_url') && cfg.get('wp_app_password')) {
    for (const type of ['posts', 'pages']) {
      for (let page = 1; page <= 40; page++) {
        let r;
        try { r = await wp.browse(type, { page, per_page: 50, status: 'publish', context: 'view' }); }
        catch { break; }
        for (const p of r.items) {
          const kw = (p.slug || '').replace(/-/g, ' ').trim() || (p.title?.rendered || '');
          if (kw) rows.push({ keyword: kw, url: p.link, source: 'live' });
        }
        if (page >= (r.totalPages || 1)) break;
      }
    }
    // Real Rank Math focus keywords if the companion bridge plugin is installed.
    try {
      const scores = await wp.rankMathScores([]);
      for (const s of scores) if (s.focus_keyword) rows.push({ keyword: s.focus_keyword, url: null, source: 'rankmath' });
    } catch { /* bridge not installed — slug-derived keywords still cover us */ }
  }
  for (const a of db.prepare('SELECT COALESCE(focus_keyword, keyword) kw, wp_url FROM articles').all()) {
    if (a.kw) rows.push({ keyword: a.kw, url: a.wp_url, source: 'article' });
  }

  const map = new Map();
  for (const r of rows) { const n = norm(r.keyword); if (n && !map.has(n)) map.set(n, r); }
  const builtAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM keyword_index').run();
    const ins = db.prepare('INSERT OR REPLACE INTO keyword_index(norm, keyword, url, source, built_at) VALUES(?,?,?,?,?)');
    for (const [n, r] of map) ins.run(n, r.keyword, r.url || null, r.source, builtAt);
  });
  tx();
  log.info('kwindex', `Built keyword index: ${map.size} unique covered keywords`);
  return { count: map.size, builtAt };
}

// Add/refresh a single keyword (e.g. right after we publish an article).
export function add(keyword, url, source = 'article') {
  const n = norm(keyword);
  if (!n) return;
  try { db.prepare('INSERT OR REPLACE INTO keyword_index(norm, keyword, url, source, built_at) VALUES(?,?,?,?,?)').run(n, keyword, url || null, source, new Date().toISOString()); }
  catch { /* ignore */ }
}

export function status() {
  const c = db.prepare('SELECT COUNT(*) n, MAX(built_at) b FROM keyword_index').get();
  return { count: c.n || 0, builtAt: c.b || null };
}

export async function ensureBuilt() {
  if (status().count === 0) await build();
}

export function check(keyword) {
  const n = norm(keyword);
  if (!n) return { exists: false };
  const exact = db.prepare('SELECT * FROM keyword_index WHERE norm = ?').get(n);
  if (exact) return { exists: true, kind: 'exact', match: exact };
  const fk = fuzzyKey(keyword);
  if (fk) {
    for (const r of db.prepare('SELECT * FROM keyword_index').all()) {
      if (fuzzyKey(r.keyword) === fk) return { exists: true, kind: 'fuzzy', match: r };
    }
  }
  return { exists: false };
}

// Split a list into new vs already-covered.
export async function filter(keywords = [], { autoBuild = true } = {}) {
  if (autoBuild) await ensureBuilt();
  const out = { newKeywords: [], existing: [] };
  for (const k of keywords) {
    const c = check(k);
    if (c.exists) out.existing.push({ keyword: k, kind: c.kind, match: { keyword: c.match.keyword, url: c.match.url, source: c.match.source } });
    else out.newKeywords.push(k);
  }
  return out;
}

export default { build, add, status, ensureBuilt, check, filter, norm, simKey, similar };
