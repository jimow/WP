// Self-replenishing idea queue — the engine that keeps the 24/7 loop from ever
// starving. When the number of pending `idea` articles drops below the owner's
// threshold, this pulls fresh, NON-DUPLICATE keywords from (in priority order):
//   1) Google Search Console content gaps (real demand the site already gets),
//   2) Ahrefs keyword ideas for the owner's seeds / site topic,
//   3) an AI fallback that proposes keywords for the niche,
// dedupes them against everything already covered (kwindex) + the idea queue,
// and inserts them as `idea` articles for the pipeline to generate.
import db from '../db.js';
import cfg from '../config.js';
import log from '../log.js';
import ahrefs from '../clients/ahrefs.js';
import gsc from '../clients/gsc.js';
import ai from '../clients/ai.js';
import kwindex from './kwindex.js';
import articles from './articles.js';
import optimize from './optimize.js';

export function ideaQueueDepth() {
  return db.prepare("SELECT COUNT(*) n FROM articles WHERE status='idea'").get().n;
}

function seeds() {
  const raw = cfg.get('replenish_seeds') || '';
  const list = raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length) return list;
  const topic = cfg.get('site_topic') || cfg.get('brand_name');
  return topic ? [topic] : [];
}

// Keep only keywords not already covered anywhere (live posts, our index, or the
// current idea queue) — the anti-cannibalisation guarantee.
function freshOnly(keywords) {
  const queue = new Set(
    db.prepare("SELECT lower(keyword) k FROM articles").all().map((r) => r.k)
  );
  const seen = new Set();
  const out = [];
  for (const kw of keywords) {
    const k = String(kw || '').toLowerCase().trim();
    if (!k || k.length < 3 || seen.has(k) || queue.has(k)) continue;
    if (kwindex.check(k).exists) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

async function fromGapAnalysis(limit) {
  if (!gsc.configured()) return [];
  try {
    const { opportunities } = await optimize.scan(28);
    return opportunities.filter((o) => o.type === 'gap').map((o) => o.query).slice(0, limit);
  } catch (e) { log.warn('replenish', `GSC gap scan failed: ${e.message}`); return []; }
}

async function fromAhrefs(limit) {
  if (!ahrefs.configured()) return [];
  const country = cfg.get('target_country') || 'us';
  const out = [];
  for (const seed of seeds()) {
    try {
      const rows = await ahrefs.keywordIdeas(seed, country, Math.min(50, limit * 3));
      for (const r of rows) out.push(r.keyword);
    } catch (e) { log.warn('replenish', `Ahrefs ideas for "${seed}" failed: ${e.message}`); }
    if (out.length >= limit * 3) break;
  }
  return out;
}

async function fromAi(limit, exclude = []) {
  if (!ai.configured()) return [];
  const topic = cfg.get('site_topic') || cfg.get('brand_name');
  if (!topic) return [];
  try {
    const out = await ai.json({
      system: 'You are an SEO keyword strategist. Propose specific, searchable, low-to-mid competition long-tail keywords a new site can realistically rank for. Avoid head terms and brand names.',
      prompt: `Site topic/niche: "${topic}". Audience country: ${cfg.get('target_country') || 'us'}.
Propose ${limit} distinct article-worthy keywords (informational intent, long-tail, each a realistic single blog post).
Do NOT repeat or closely paraphrase any of these already-covered keywords: ${exclude.slice(0, 60).join('; ') || '(none)'}.
Return JSON {"keywords":["...", "..."]}`,
      maxTokens: 1200,
    });
    return Array.isArray(out.keywords) ? out.keywords : [];
  } catch (e) { log.warn('replenish', `AI keyword fallback failed: ${e.message}`); return []; }
}

const upsertKeyword = db.prepare(`
  INSERT INTO keywords(keyword, source, status) VALUES(?, ?, 'clustered')
  ON CONFLICT(keyword) DO UPDATE SET status='clustered'
`);

// Run one replenishment pass. Returns {before, added, source, queue}.
export async function run({ force = false } = {}) {
  const min = cfg.getInt('min_idea_queue', 5);
  const before = ideaQueueDepth();
  if (!force && before >= min) return { before, added: 0, source: null, queue: before, skipped: 'queue healthy' };

  // How many fresh ideas to add — refill to min plus a small buffer.
  const want = Math.max(min - before, 0) + cfg.getInt('replenish_batch', 5);
  const covered = db.prepare("SELECT keyword FROM articles").all().map((r) => r.keyword);

  // Source priority: GSC gaps → Ahrefs → AI. Stop once we have enough fresh ones.
  let picked = [];
  let source = null;
  for (const [name, fn] of [
    ['gsc-gap', () => fromGapAnalysis(want * 2)],
    ['ahrefs', () => fromAhrefs(want)],
    ['ai', () => fromAi(want, covered)],
  ]) {
    if (picked.length >= want) break;
    const cand = freshOnly(await fn());
    if (cand.length) { picked = picked.concat(cand); source = source ? `${source}+${name}` : name; }
  }
  picked = [...new Set(picked)].slice(0, want);

  let added = 0;
  const tx = db.transaction((kws) => {
    for (const kw of kws) {
      try { upsertKeyword.run(kw, source || 'replenish'); } catch { /* ignore */ }
      articles.addIdea(kw, 'spoke');
      added++;
    }
  });
  tx(picked);

  const queue = ideaQueueDepth();
  if (added) log.info('replenish', `Added ${added} fresh ideas (source: ${source}); queue ${before}→${queue}`);
  else log.info('replenish', `No fresh ideas found this pass (queue ${queue}, min ${min})`);
  return { before, added, source, queue };
}

export default { run, ideaQueueDepth };
