// GSC ↔ WordPress synergy engine. Reads Search Console performance, finds the
// highest-leverage opportunities, and turns them into concrete WordPress edits
// (title/meta CTR rewrites, content refreshes) that you approve and push live.
import gsc from '../clients/gsc.js';
import wp from '../clients/wp.js';
import ai from '../clients/ai.js';
import cfg from '../config.js';
import db from '../db.js';
import log from '../log.js';
import articles from './articles.js';
import seo from './seo.js';

const round = (n) => Math.round(n * 10) / 10;

function range(days = 28) {
  const end = new Date(); end.setDate(end.getDate() - 2);
  const start = new Date(end); start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// Rough organic CTR-by-position benchmark (Google desktop, blended).
const EXPECTED_CTR = [0, 0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.032, 0.027, 0.025];
const expectedCtr = (pos) => EXPECTED_CTR[Math.min(Math.max(Math.round(pos), 1), 10)] || 0.02;

// ---- Scan: find opportunities --------------------------------------------
export async function scan(days = 28) {
  if (!gsc.configured()) throw new Error('Connect Search Console first.');
  const { startDate, endDate } = range(days);
  // All thresholds are owner-configured (Settings → Opportunity rules) — nothing hard-coded.
  const minImpr = cfg.getInt('opt_min_impressions', 30);
  const posMin = cfg.getInt('opt_pos_min', 8);
  const posMax = cfg.getInt('opt_pos_max', 20);
  const ctrRatio = parseFloat(cfg.get('opt_ctr_ratio')) || 0.6;
  const gapPos = cfg.getInt('gap_min_position', 15);
  const [byPage, byQuery, byQP] = await Promise.all([
    gsc.query({ startDate, endDate, dimensions: ['page'], rowLimit: 250 }),
    gsc.query({ startDate, endDate, dimensions: ['query'], rowLimit: 500 }),
    gsc.query({ startDate, endDate, dimensions: ['query', 'page'], rowLimit: 1000 }),
  ]);

  const opps = [];

  // 1) Low CTR on page-1 pages → rewrite title + meta.
  for (const r of byPage) {
    const pos = r.position;
    if (r.impressions >= minImpr && pos <= 10) {
      const exp = expectedCtr(pos);
      if (r.ctr < exp * ctrRatio) {
        opps.push({ type: 'ctr', url: r.keys[0], impressions: r.impressions, ctr: r.ctr, position: round(pos),
          expectedCtr: exp, gain: Math.round(r.impressions * (exp - r.ctr)),
          action: 'Rewrite SEO title & meta description to lift click-through' });
      }
    }
  }
  // 2) Striking-distance pages (owner-set position range) → refresh/expand content.
  for (const r of byPage) {
    if (r.impressions >= minImpr && r.position >= posMin && r.position <= posMax) {
      opps.push({ type: 'refresh', url: r.keys[0], impressions: r.impressions, position: round(r.position), ctr: r.ctr,
        gain: Math.round(r.impressions * 0.25),
        action: 'Expand & refresh content + internal links to reach page 1' });
    }
  }
  // 3) Content gaps: queries with demand but weak/no ranking and no article yet.
  const publishedKw = new Set(db.prepare("SELECT lower(keyword) k FROM articles").all().map((r) => r.k));
  for (const r of byQuery) {
    const q = r.keys[0];
    if (r.impressions >= minImpr && r.position > gapPos && !publishedKw.has(q.toLowerCase())) {
      opps.push({ type: 'gap', query: q, impressions: r.impressions, position: round(r.position),
        gain: Math.round(r.impressions * 0.08),
        action: 'Create a dedicated article targeting this query' });
    }
  }
  // 4) Cannibalization: one query, multiple competing pages.
  const grouped = {};
  for (const r of byQP) {
    const [q, page] = r.keys;
    (grouped[q] = grouped[q] || []).push({ page, impr: r.impressions, pos: r.position });
  }
  for (const [q, arr] of Object.entries(grouped)) {
    const sig = arr.filter((a) => a.impr >= Math.max(8, minImpr / 3));
    if (sig.length >= 2) {
      opps.push({ type: 'cannibal', query: q, pages: sig.map((s) => s.page), impressions: sig.reduce((a, b) => a + b.impr, 0),
        gain: 0, action: `${sig.length} pages compete for this query — consolidate or differentiate` });
    }
  }

  opps.sort((a, b) => (b.gain || 0) - (a.gain || 0));
  return { range: { startDate, endDate, days }, count: opps.length, opportunities: opps.slice(0, 120) };
}

// ---- Prepare a concrete fix (stores an optimization row) ------------------
function applyStatusForWp() {
  return cfg.get('publish_status') === 'draft' ? 'draft' : 'publish';
}

const insertOpt = db.prepare(`INSERT INTO optimizations(type, target_url, query, post_id, post_type, metrics, before, after, gain, status, note)
  VALUES(@type, @url, @query, @post_id, @post_type, @metrics, @before, @after, @gain, @status, @note)`);

export async function prepareCtr(url, days = 28) {
  const { startDate, endDate } = range(days);
  const post = await wp.findByUrl(url);
  const queries = await gsc.queriesForPage(url, { startDate, endDate, rowLimit: 12 });
  const qList = queries.map((r) => `${r.keys[0]} (pos ${round(r.position)}, ${r.impressions} impr, CTR ${(r.ctr * 100).toFixed(1)}%)`).join('\n') || '(no query data)';
  const title = post.title?.raw || post.title?.rendered || '';
  const desc = post.excerpt?.raw || '';

  const out = await ai.json({
    system: 'You are an SEO copywriter who maximises organic click-through rate while staying accurate and non-clickbait.',
    prompt: `This page already ranks but under-performs on CTR. Write a stronger SEO title and meta description.
Title rules: ≤60 chars, include the top query, ideally a number and/or power word, lead with the benefit.
Meta rules: ≤155 chars, include the top query, concrete value + soft call-to-action.
Page title: ${title}
URL: ${url}
Top queries:
${qList}
Return JSON {"title":"...","meta_description":"..."}`,
    maxTokens: 500,
  });

  const info = insertOpt.run({
    type: 'ctr', url, query: queries[0]?.keys[0] || null, post_id: post.id, post_type: post.kind,
    metrics: JSON.stringify({ queries: queries.slice(0, 5).map((r) => ({ q: r.keys[0], pos: round(r.position), impr: r.impressions, ctr: r.ctr })) }),
    before: JSON.stringify({ title, meta_description: desc }),
    after: JSON.stringify({ title: out.title, meta_description: out.meta_description }),
    gain: 0, status: 'prepared', note: null,
  });
  log.info('optimize', `Prepared CTR rewrite for ${url}`);
  return getOptimization(info.lastInsertRowid);
}

export async function prepareRefresh(url, days = 28) {
  const { startDate, endDate } = range(days);
  const post = await wp.findByUrl(url);
  const queries = await gsc.queriesForPage(url, { startDate, endDate, rowLimit: 20 });
  const qList = queries.map((r) => `${r.keys[0]} (pos ${round(r.position)}, ${r.impressions} impr)`).join('\n') || '(no query data)';
  const title = post.title?.raw || post.title?.rendered || '';
  const content = post.content?.raw || post.content?.rendered || '';

  const out = await ai.json({
    system: 'You are an expert SEO editor refreshing existing content to rank higher. Preserve correct facts and existing internal links; improve depth, structure, freshness and coverage of the near-ranking queries. Output WordPress Gutenberg block markup.',
    prompt: `Refresh and expand this article so it can move from page 2 to page 1. Add sections/answers for the near-ranking queries below, improve headings and internal linking, and update anything stale. Keep the same topic and URL.
Title: ${title}
Near-ranking queries to satisfy:
${qList}

Current content:
${content.slice(0, 12000)}

Return JSON {"content":"<improved full Gutenberg block markup>","summary":"1-2 lines on what you changed"}`,
    maxTokens: 9000,
  });

  const info = insertOpt.run({
    type: 'refresh', url, query: queries[0]?.keys[0] || null, post_id: post.id, post_type: post.kind,
    metrics: JSON.stringify({ queries: queries.slice(0, 8).map((r) => ({ q: r.keys[0], pos: round(r.position), impr: r.impressions })) }),
    before: JSON.stringify({ title, content }),
    after: JSON.stringify({ content: out.content }),
    gain: 0, status: 'prepared', note: out.summary || null,
  });
  log.info('optimize', `Prepared content refresh for ${url}`);
  return getOptimization(info.lastInsertRowid);
}

// De-stuff a live post: reduce keyword over-optimisation (too-high density) by
// rewriting most exact-keyword occurrences as synonyms/pronouns, WITHOUT losing
// any content. Stores a reviewable optimization (before/after) for one-click apply.
export async function prepareDestuff(url) {
  const post = await wp.findByUrl(url);
  const postType = post.kind === 'page' ? 'pages' : 'posts';
  const title = post.title?.raw || post.title?.rendered || '';
  const content = post.content?.raw || post.content?.rendered || '';
  if (!content) throw new Error('That post has no readable content.');
  // Focus keyword: Rank Math meta (if exposed) → slug fallback.
  let kw = '';
  try { kw = (await wp.getRankMath(post.id, postType)).focusKeyword || ''; } catch { /* meta not exposed */ }
  if (!kw) kw = (post.slug || '').replace(/-/g, ' ').trim();
  if (!kw) throw new Error('Could not determine the focus keyword for this post.');

  const before = seo.score({ title, slug: post.slug || '', content, focusKeyword: kw });
  const densMax = parseFloat(cfg.get('seo_density_max')) || 1.5;
  const densTarget = parseFloat(cfg.get('seo_keyword_density')) || 1.2;
  if (before.density <= densMax) {
    return { alreadyOk: true, keyword: kw, density: before.density, kwCount: before.kwCount, words: before.words };
  }
  const budget = Math.max(4, Math.round((densTarget / 100) * before.words));

  const out = await ai.json({
    system: 'You are an SEO editor fixing keyword over-optimisation (stuffing). Reduce how often the EXACT focus-keyword phrase appears by replacing most occurrences with natural synonyms, pronouns ("it", "this method") and related terms. PRESERVE every fact, section, heading, list, link and image and keep the SAME overall length — only change wording. Output valid WordPress Gutenberg block markup.',
    prompt: `The focus keyword "${kw}" currently appears ${before.kwCount} times (${before.density}% density) in a ${before.words}-word post — that's keyword stuffing. Rewrite so the EXACT phrase "${kw}" appears about ${budget} times total (~${densTarget}% density), no fewer than ${Math.max(4, budget - 2)}. Do NOT shorten or remove content.

Return JSON {"content":"<full Gutenberg block markup, complete>","summary":"one line on what changed"}.

Current content:
${content.slice(0, 22000)}`,
    maxTokens: 9000,
  });

  const newContent = out.content || '';
  const after = seo.score({ title, slug: post.slug || '', content: newContent, focusKeyword: kw });
  // Safety: never accept output that lost a big chunk of the post or didn't help.
  if (after.words < before.words * 0.7) {
    throw new Error(`De-stuff aborted — rewrite was too short (${after.words} vs ${before.words} words). Post left unchanged.`);
  }
  if (after.density >= before.density) {
    throw new Error(`De-stuff didn't lower density (${before.density}% → ${after.density}%). Post left unchanged.`);
  }

  const info = insertOpt.run({
    type: 'destuff', url, query: kw, post_id: post.id, post_type: post.kind,
    metrics: JSON.stringify({ keyword: kw, densityBefore: before.density, densityAfter: after.density, kwBefore: before.kwCount, kwAfter: after.kwCount, words: after.words }),
    before: JSON.stringify({ content }),
    after: JSON.stringify({ content: newContent }),
    gain: 0, status: 'prepared', note: out.summary || `Density ${before.density}% → ${after.density}% (${before.kwCount}→${after.kwCount} uses)`,
  });
  log.info('optimize', `Prepared de-stuff for ${url}: ${before.density}%→${after.density}%`);
  return getOptimization(info.lastInsertRowid);
}

// Turn a content-gap query into an article idea (optionally generate now).
export async function gapToIdea(query, { generate = false } = {}) {
  const id = articles.addIdea(query, 'spoke');
  if (generate) await articles.generate(id);
  return { articleId: id };
}

// ---- Apply / manage stored optimizations ----------------------------------
export function listOptimizations(status) {
  const rows = status
    ? db.prepare('SELECT * FROM optimizations WHERE status = ? ORDER BY id DESC').all(status)
    : db.prepare("SELECT * FROM optimizations WHERE status != 'dismissed' ORDER BY id DESC").all();
  return rows.map(hydrate);
}
export function getOptimization(id) {
  const r = db.prepare('SELECT * FROM optimizations WHERE id = ?').get(id);
  return r ? hydrate(r) : null;
}
function hydrate(r) {
  return { ...r,
    metrics: r.metrics ? JSON.parse(r.metrics) : null,
    before: r.before ? JSON.parse(r.before) : null,
    after: r.after ? JSON.parse(r.after) : null };
}

export async function apply(id) {
  const o = db.prepare('SELECT * FROM optimizations WHERE id = ?').get(id);
  if (!o) throw new Error('Optimization not found');
  if (!o.post_id) throw new Error('No WordPress target for this optimization');
  const after = o.after ? JSON.parse(o.after) : {};
  const fields = {};
  if (after.title) fields.title = after.title;
  if (after.content) fields.content = after.content;
  if (after.meta_description) fields.excerpt = after.meta_description;
  // Rank Math meta for CTR rewrites.
  if (cfg.getBool('rankmath_meta') && (after.title || after.meta_description)) {
    fields.meta = {};
    if (after.title) fields.meta.rank_math_title = after.title;
    if (after.meta_description) fields.meta.rank_math_description = after.meta_description;
  }
  const status = applyStatusForWp();
  if (status === 'publish') fields.status = 'publish'; // keep it live
  if (o.post_type === 'page') await wp.updatePage(o.post_id, fields);
  else await wp.updatePost(o.post_id, fields);
  db.prepare("UPDATE optimizations SET status='applied', applied_at=datetime('now') WHERE id=?").run(id);
  log.info('optimize', `Applied ${o.type} optimization to ${o.target_url}`);
  return getOptimization(id);
}

export function dismiss(id) {
  db.prepare("UPDATE optimizations SET status='dismissed' WHERE id=?").run(id);
  return { ok: true };
}

export default { scan, prepareCtr, prepareRefresh, prepareDestuff, gapToIdea, listOptimizations, getOptimization, apply, dismiss };
