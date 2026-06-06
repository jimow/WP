// SEO Strategy engine. Two layers:
//  1) audit() — a LIVE, data-driven pass over the real site: inventories every
//     published post, joins Search Console metrics, and uses the AI as an SEO
//     strategist to classify each article (keep / improve_ctr / refresh / expand /
//     add_spokes / merge / prune), map hub-and-spoke clusters, flag new hubs and
//     content gaps, and propose internal links.
//  2) strategy doc — the deep 6-month roadmap produced by the multi-agent
//     workflow (stored as JSON; surfaced in the Strategy tab).
import wp from '../clients/wp.js';
import gsc from '../clients/gsc.js';
import ai from '../clients/ai.js';
import cfg from '../config.js';
import log from '../log.js';

function range(days = 28) {
  const end = new Date(); end.setDate(end.getDate() - 2);
  const start = new Date(end); start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}
const norm = (u) => (u || '').trim().toLowerCase().replace(/\/+$/, '');

async function allPublishedPosts(max = 150) {
  const out = [];
  for (let page = 1; page <= 30 && out.length < max; page++) {
    let r;
    try { r = await wp.browse('posts', { page, per_page: 50, status: 'publish', context: 'view' }); }
    catch { break; }
    for (const p of r.items) out.push({ id: p.id, title: p.title?.rendered || p.title?.raw || '', url: p.link, date: (p.date || '').slice(0, 10) });
    if (page >= r.totalPages) break;
  }
  return out;
}

export async function audit() {
  const posts = await allPublishedPosts();
  if (!posts.length) throw new Error('No published posts found on the site (check the WordPress connection).');

  // Join GSC metrics where available.
  let gscMap = {};
  if (gsc.configured()) {
    try {
      const { startDate, endDate } = range(28);
      const rows = await gsc.query({ startDate, endDate, dimensions: ['page'], rowLimit: 1000 });
      for (const r of rows) gscMap[norm(r.keys[0])] = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: Math.round(r.position * 10) / 10 };
    } catch (e) { log.warn('strategy', `GSC join failed: ${e.message}`); }
  }
  const enriched = posts.map((p) => ({ ...p, gsc: gscMap[norm(p.url)] || null }));

  // Pick the most meaningful inventory for the model (by impressions, then recency).
  const inv = [...enriched].sort((a, b) => (b.gsc?.impressions || 0) - (a.gsc?.impressions || 0)).slice(0, 45);
  const invText = inv.map((p, i) => `${i + 1}. "${p.title}" — ${p.url}${p.gsc ? ` [${p.gsc.impressions} impr, pos ${p.gsc.position}, ${p.gsc.clicks} clicks, CTR ${(p.gsc.ctr * 100).toFixed(1)}%]` : ' [no GSC data]'}`).join('\n');

  const topic = cfg.get('site_topic') || cfg.get('brand_name') || 'this website';
  const result = await ai.json({
    system: `You are a senior SEO strategist auditing ${topic}. Use the real titles + Search Console metrics to give specific, data-driven recommendations. Striking-distance = position 5-20; low CTR = clicks far below impressions for the position; thin/decaying = low impressions or falling.`,
    prompt: `Audit this site's published articles and produce a hub-and-spoke strategy.

ARTICLES (title — url [metrics]):
${invText}

Return JSON:
{
  "clusters": [{"hub":"existing or proposed pillar topic","status":"existing|new","spokes":["urls or titles that belong here"],"gaps":["spoke article ideas to create (titles)"]}],
  "newHubs": ["pillar pages worth creating"],
  "actions": [{"url":"...","title":"...","action":"keep|improve_ctr|refresh|expand|add_spokes|merge|prune","reason":"data-backed reason","priority":"high|medium|low"}],
  "internalLinks": [{"from":"url/title","to":"url/title","anchor":"natural anchor text","why":"flows authority to a hub / connects related spokes"}],
  "quickWins": ["the 5 highest-ROI actions to do first"]
}
Cover EVERY article in actions. Prioritise striking-distance refreshes and low-CTR rewrites as quick wins.`,
    maxTokens: 16000,
  });

  const summary = {
    posts: posts.length,
    withGsc: enriched.filter((p) => p.gsc).length,
    counts: (result.actions || []).reduce((a, x) => ((a[x.action] = (a[x.action] || 0) + 1), a), {}),
  };
  const audit = { generatedAt: new Date().toISOString(), summary, ...result };
  cfg.set('last_audit', JSON.stringify(audit));
  log.info('strategy', `Audited ${posts.length} posts → ${(result.actions || []).length} actions, ${(result.clusters || []).length} clusters`);
  return audit;
}

export function getAudit() {
  const raw = cfg.get('last_audit');
  return raw ? JSON.parse(raw) : null;
}

// ---- Strategy doc (the workflow's 6-month roadmap) ------------------------
export function getStrategy() {
  const raw = cfg.get('strategy_doc');
  return raw ? JSON.parse(raw) : null;
}
export function saveStrategy(doc) {
  cfg.set('strategy_doc', typeof doc === 'string' ? doc : JSON.stringify(doc));
  log.info('strategy', 'Saved strategy/roadmap document');
  return getStrategy();
}

export default { audit, getAudit, getStrategy, saveStrategy };
