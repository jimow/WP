// Hub-and-spoke planning. Given a set of keywords (or a seed topic), ask the AI
// to organise them into topic clusters: one pillar/hub per cluster plus the
// supporting spoke articles. Each spoke becomes an article "idea" row.
import db from '../db.js';
import ai from '../clients/ai.js';
import cfg from '../config.js';
import log from '../log.js';
import kwindex from './kwindex.js';

const insertCluster = db.prepare(
  'INSERT INTO clusters(name, hub_keyword, intent, status) VALUES(?, ?, ?, ?)'
);
const insertItem = db.prepare(
  'INSERT INTO cluster_items(cluster_id, keyword, role) VALUES(?, ?, ?)'
);
const insertArticleIdea = db.prepare(
  'INSERT INTO articles(cluster_id, keyword, role, status) VALUES(?, ?, ?, ?)'
);

// PROPOSE a hub-and-spoke structure with the AI — does NOT persist (so the user
// can review/edit before committing). Follows hub-and-spoke best practice.
export async function propose({ keywords, maxClusters, spokesPerCluster, intent, brief } = {}) {
  let kws = keywords && keywords.length
    ? keywords
    : db.prepare("SELECT keyword, volume, difficulty FROM keywords WHERE status='new' ORDER BY volume DESC NULLS LAST LIMIT 80").all();
  if (!kws.length) throw new Error('No keywords to cluster. Add a focus keyword first.');

  maxClusters = maxClusters || cfg.getInt('clusters_default', 3);
  const spokes = spokesPerCluster || cfg.getInt('spokes_per_cluster', 6);
  intent = intent || cfg.get('cluster_intent') || 'mixed';
  const topic = cfg.get('site_topic') || cfg.get('brand_name') || 'this website';

  // Cap the seed list so the prompt + the requested JSON stay within the model's
  // token budget (oversized lists are the #1 cause of an empty/truncated reply).
  // Prefer the highest-volume keywords when volume data is present.
  const MAX_SEEDS = cfg.getInt('cluster_max_seeds', 140);
  let truncatedFrom = 0;
  if (kws.length > MAX_SEEDS) {
    truncatedFrom = kws.length;
    kws = [...kws].sort((a, b) => ((typeof b === 'object' ? b.volume || 0 : 0) - (typeof a === 'object' ? a.volume || 0 : 0))).slice(0, MAX_SEEDS);
    log.info('clusters', `Capped ${truncatedFrom} seed keywords → ${MAX_SEEDS} for proposal (token budget).`);
  }

  const list = kws.map((k) => (typeof k === 'string' ? k : `${k.keyword}${k.volume ? ` (vol ${k.volume}${k.difficulty != null ? `, KD ${k.difficulty}` : ''})` : ''}`)).join('\n');
  const intentLine = intent === 'mixed'
    ? 'Pick the most fitting search intent per cluster (informational, commercial, or transactional).'
    : `Prioritise ${intent} search intent.`;

  // Size the output budget to the expected JSON (clusters × spokes), with headroom.
  const maxTokens = Math.min(8000, Math.max(2500, 1800 + maxClusters * (spokes + 2) * 45));

  const plan = await ai.json({
    system: `You are an SEO content strategist building TOPICAL hub-and-spoke architecture for ${topic}.
A HUB is a BROAD PILLAR page about an entire topic/theme — a comprehensive umbrella guide. It is NOT one of the seed keywords reworded; it is the overarching subject the cluster lives under.
SPOKES are separate, narrower articles that each cover ONE DISTINCT subtopic in depth and link UP to the hub; the hub links DOWN to every spoke.
CRITICAL RULES:
- The hub must be a genuine topic/theme, broader than any spoke (e.g. hub "Matrix algebra" → spokes "how to multiply matrices", "finding a matrix inverse", "matrix determinant explained").
- Spokes must be genuinely DIFFERENT subtopics — never synonyms or near-duplicates of the hub OR of each other (that causes keyword cannibalisation).
- MERGE near-duplicate seed keywords into ONE spoke (e.g. "matrix inverse", "inverse of a matrix", "how to invert a matrix" → a single spoke). Do NOT output them as separate spokes.
Output ONLY compact JSON.`,
    prompt: `Organise these seed keyword(s) into at most ${maxClusters} topic cluster(s).
For each cluster:
- "name": the topic/theme name.
- "hub_keyword": the BROAD pillar topic that umbrellas the cluster (not a narrow query, not a duplicate of any spoke).
- "spokes": about ${spokes} DISTINCT subtopic keywords, each a separate article on a different angle. Every spoke must be clearly different from the hub and from the other spokes.
Group by topical relevance and intent; prefer realistic, winnable keywords. ${intentLine}
${brief ? `Extra requirements from the user: ${brief}` : ''}
You may add strong spoke keywords beyond the seeds if they fill a genuine subtopic gap, but keep them tightly on-topic and non-overlapping. Keep names short.

Seed keyword(s):
${list}

Return JSON: {"clusters":[{"name":"...","hub_keyword":"...","intent":"informational|commercial|transactional","spokes":["...","..."]}]}`,
    maxTokens,
  });
  const clusters = plan.clusters || [];
  if (!clusters.length) {
    throw new Error(`The AI returned no clusters for ${kws.length} keyword(s). Try fewer keywords or fewer clusters/spokes, or switch to a model with a larger output budget.`);
  }
  return clusters;
}

// CREATE clusters from a (possibly user-edited) plan — persists + queues article
// ideas. Skips any keyword already covered (dedup) unless allowDuplicates.
export function createFromPlan(clusters = [], { allowDuplicates = false } = {}) {
  const created = [];
  const skipped = [];
  const covered = (kw) => !allowDuplicates && kwindex.check(kw).exists;
  const tx = db.transaction((list) => {
    for (const c of list) {
      if (!c.hub_keyword) continue;
      const info = insertCluster.run(c.name || `${c.hub_keyword} (hub)`, c.hub_keyword, c.intent || 'informational', 'planned');
      const clusterId = info.lastInsertRowid;
      // Track normalised keys within THIS cluster so a spoke that's a near-duplicate
      // of the hub (or another spoke) is dropped — the hub is the topic, spokes are
      // distinct subtopics, never the same/similar keyword.
      const seen = new Set([kwindex.simKey(c.hub_keyword)]);
      insertItem.run(clusterId, c.hub_keyword, 'hub');
      if (covered(c.hub_keyword)) skipped.push(c.hub_keyword); else insertArticleIdea.run(clusterId, c.hub_keyword, 'hub', 'idea');
      for (const sp of c.spokes || []) {
        if (!sp || !String(sp).trim()) continue;
        const n = kwindex.simKey(sp);
        if (seen.has(n)) { skipped.push(sp); continue; } // same/similar to hub / another spoke
        seen.add(n);
        insertItem.run(clusterId, sp, 'spoke');
        if (covered(sp)) skipped.push(sp); else insertArticleIdea.run(clusterId, sp, 'spoke', 'idea');
      }
      db.prepare("UPDATE keywords SET status='clustered' WHERE keyword IN (SELECT keyword FROM cluster_items WHERE cluster_id=?)").run(clusterId);
      created.push({ id: clusterId, name: c.name, spokes: (c.spokes || []).length });
    }
  });
  tx(clusters);
  if (skipped.length) log.info('clusters', `Skipped ${skipped.length} duplicate/near-duplicate keyword(s): ${skipped.slice(0, 6).join(', ')}`);
  return { created, skipped };
}

// Convenience: propose + create in one step (used by the older "Plan" button).
export async function planFromKeywords(opts = {}) {
  return createFromPlan(await propose(opts));
}

// AI-suggest NEW spoke keywords for a cluster (the user picks which to add).
export async function suggestSpokes(clusterId, count = 6) {
  const c = db.prepare('SELECT * FROM clusters WHERE id = ?').get(clusterId);
  if (!c) throw new Error('Cluster not found');
  const existing = db.prepare('SELECT keyword FROM cluster_items WHERE cluster_id = ?').all(clusterId).map((r) => r.keyword);
  const topic = cfg.get('site_topic') || cfg.get('brand_name') || 'this website';
  const out = await ai.json({
    system: `You are an SEO topical-authority strategist for ${topic}.`,
    prompt: `Hub/pillar: "${c.hub_keyword}" (intent: ${c.intent || 'informational'}).
Existing spokes: ${existing.join(', ') || 'none'}.
Suggest ${count} NEW, specific, winnable spoke keywords (each a supporting article) that strengthen this topic cluster and do NOT duplicate the existing ones. Prefer real search queries with clear intent.
Return JSON: {"spokes":["...","..."]}`,
    maxTokens: 700,
  });
  return (out.spokes || []).filter((s) => s && !existing.includes(s));
}

// Convert an existing article into a HUB: create a cluster around it and add the
// suggested spoke keywords as new article ideas attached to that cluster.
export function convertArticleToHub(articleId, spokes = []) {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  if (!a) throw new Error('Article not found');
  const hubKw = a.focus_keyword || a.keyword;
  const info = insertCluster.run(`${hubKw} (hub)`, hubKw, 'informational', 'active');
  const clusterId = info.lastInsertRowid;
  insertItem.run(clusterId, hubKw, 'hub');
  db.prepare("UPDATE articles SET cluster_id=?, role='hub', updated_at=datetime('now') WHERE id=?").run(clusterId, articleId);

  let added = 0;
  const linked = [];                          // spokes that ALREADY exist → linked, NOT regenerated
  const seen = new Set([kwindex.norm(hubKw)]); // de-dupe within the suggestion list (and vs the hub)
  for (const sp of spokes) {
    const kw = (sp || '').trim();
    if (!kw) continue;
    const n = kwindex.norm(kw);
    if (n && seen.has(n)) continue;
    if (n) seen.add(n);

    // 1) Do WE already have an article for this keyword (any status)? Join it to
    //    the cluster as a spoke — don't duplicate or regenerate.
    const localArt = db.prepare(
      "SELECT id, wp_url, title, status FROM articles WHERE lower(COALESCE(NULLIF(TRIM(focus_keyword), ''), keyword)) = lower(?) AND id != ? AND (cluster_id IS NULL OR cluster_id = ?) LIMIT 1"
    ).get(kw, articleId, clusterId);
    if (localArt) {
      db.prepare("UPDATE articles SET cluster_id=?, role='spoke', updated_at=datetime('now') WHERE id=?").run(clusterId, localArt.id);
      insertItem.run(clusterId, kw, 'spoke');
      linked.push({ keyword: kw, url: localArt.wp_url || null, title: localArt.title || kw, source: 'your content' });
      continue;
    }
    // 2) Is it ALREADY PUBLISHED on the live site? (keyword_index = live WP posts +
    //    Rank Math + our posts.) Represent it as a published spoke so the hub
    //    interlinks to its real URL — no regeneration.
    const m = kwindex.check(kw);
    if (m.exists && m.match && m.match.url) {
      db.prepare("INSERT INTO articles(cluster_id, keyword, focus_keyword, role, status, wp_url) VALUES(?,?,?,'spoke','published',?)")
        .run(clusterId, kw, kw, m.match.url);
      insertItem.run(clusterId, kw, 'spoke');
      linked.push({ keyword: kw, url: m.match.url, title: m.match.keyword || kw, source: m.match.source || 'live' });
      continue;
    }
    // 3) Genuinely missing → create an idea to generate.
    insertItem.run(clusterId, kw, 'spoke');
    db.prepare("INSERT INTO articles(cluster_id, keyword, role, status) VALUES(?, ?, 'spoke', 'idea')").run(clusterId, kw);
    added++;
  }
  log.info('clusters', `Converted #${articleId} to hub "${hubKw}": ${added} new spoke(s) to generate, ${linked.length} existing linked (deduped)`);
  return { clusterId, hub: hubKw, spokesAdded: added, existingLinked: linked.length, existing: linked };
}

export function list() {
  const clusters = db.prepare('SELECT * FROM clusters ORDER BY created_at DESC').all();
  for (const c of clusters) {
    c.items = db.prepare('SELECT * FROM cluster_items WHERE cluster_id = ? ORDER BY role DESC').all(c.id);
    c.articleCounts = db.prepare(
      "SELECT status, COUNT(*) n FROM articles WHERE cluster_id = ? GROUP BY status"
    ).all(c.id).reduce((a, r) => ((a[r.status] = r.n), a), {});
  }
  return clusters;
}

export function get(id) {
  const c = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id);
  if (!c) return null;
  c.items = db.prepare('SELECT * FROM cluster_items WHERE cluster_id = ?').all(id);
  c.articles = db.prepare('SELECT id, keyword, role, status, title FROM articles WHERE cluster_id = ?').all(id);
  return c;
}

export function remove(id) {
  db.prepare('DELETE FROM clusters WHERE id = ?').run(id);
}

export default { propose, createFromPlan, planFromKeywords, suggestSpokes, convertArticleToHub, list, get, remove };
