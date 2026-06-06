// Per-post intelligence — works on a draft (our article) OR a live post (URL).
// For one target (by its focus keyword) it:
//  • searches the SERP (Ahrefs) for the focus keyword and SCRAPES the TOP 10
//    ranking pages' real content (headings, meta, word count, excerpt),
//  • compares them against THIS page and reports what they cover that you DON'T,
//    with concrete, apply-ready EDIT advice,
//  • assesses HUB potential, backlink steps and internal links,
//  • PERSISTS the whole analysis so it survives navigation (re-shown on reopen),
//  • can APPLY the improvements by editing the draft.
import db from '../db.js';
import ai from '../clients/ai.js';
import ahrefs from '../clients/ahrefs.js';
import wp from '../clients/wp.js';
import cfg from '../config.js';
import log from '../log.js';
import seo from './seo.js';

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const headingsOf = (html) => [...String(html || '').matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => stripTags(m[1])).filter(Boolean);

// Fetch and lightly parse a competitor page: title, meta description, headings,
// word count and a text excerpt — enough for a real content-gap comparison.
async function fetchPageContent(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WPAutopilot/1.0)' }, signal: AbortSignal.timeout(9000) });
    const html = await res.text();
    const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
    const headings = headingsOf(html).slice(0, 40);
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<nav[\s\S]*?<\/nav>/gi, ' ').replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
    const words = stripTags(body).split(/\s+/).filter(Boolean);
    return { url, title, metaDesc, headings, wordCount: words.length, excerpt: words.slice(0, 160).join(' ') };
  } catch { return { url, title: '', metaDesc: '', headings: [], wordCount: 0, excerpt: '' }; }
}

// Resolve a target ({articleId} | {url}) into a uniform shape.
async function resolveTarget(target) {
  if (target.articleId) {
    const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(target.articleId);
    if (!a) throw new Error('Article not found');
    return { kind: 'article', id: a.id, ref: `article:${a.id}`, kw: (a.focus_keyword || a.keyword || '').trim(), title: a.title || a.keyword, slug: a.slug, meta: a.meta_description, content: a.content || '', wp_url: a.wp_url, wp_post_id: a.wp_post_id };
  }
  if (target.url) {
    const p = await wp.findByUrl(target.url);
    let kw = '';
    try { kw = (await wp.getRankMath(p.id, p.kind === 'page' ? 'pages' : 'posts')).focusKeyword || ''; } catch { /* meta not exposed */ }
    if (!kw) kw = (p.slug || '').replace(/-/g, ' ').trim() || stripTags(p.title?.rendered || '');
    return { kind: p.kind, id: p.id, ref: p.link || target.url, postType: p.kind === 'page' ? 'pages' : 'posts', kw, title: p.title?.rendered || p.title?.raw || '', content: p.content?.raw || p.content?.rendered || '', wp_url: p.link, wp_post_id: p.id };
  }
  throw new Error('No analysis target (need articleId or url).');
}

// --- Persistence -----------------------------------------------------------
function save(ref, kind, keyword, result) {
  db.prepare(`INSERT INTO post_analyses(target_ref, target_kind, keyword, result, created_at)
    VALUES(?,?,?,?, datetime('now'))
    ON CONFLICT(target_ref) DO UPDATE SET target_kind=excluded.target_kind, keyword=excluded.keyword, result=excluded.result, created_at=excluded.created_at`)
    .run(ref, kind, keyword, JSON.stringify(result));
}
// Read the latest persisted analysis for a target (or null).
export function getLatest(target) {
  const ref = target.articleId ? `article:${target.articleId}` : target.url;
  if (!ref) return null;
  const row = db.prepare('SELECT * FROM post_analyses WHERE target_ref = ?').get(ref);
  if (!row) return null;
  let result = {}; try { result = JSON.parse(row.result); } catch { /* */ }
  return { ...result, analyzedAt: row.created_at, persisted: true };
}

export async function analyze(target) {
  const t = await resolveTarget(target);
  const kw = t.kw;
  if (!kw) throw new Error('No focus keyword to analyse.');
  const country = cfg.get('target_country') || 'us';

  let competitors = [];
  if (ahrefs.configured()) {
    try { competitors = await ahrefs.serpOverview(kw, country, 10); }
    catch (e) { log.warn('postintel', `SERP overview failed: ${e.message}`); }
  }
  // Scrape the TOP 10 ranking pages' real content (parallel, individually timed).
  const scraped = (await Promise.all(competitors.slice(0, 10).map((c) => fetchPageContent(c.url)))).filter((s) => s.headings.length || s.wordCount > 50);

  let internalCandidates = [];
  if (cfg.get('wp_base_url') && cfg.get('wp_app_password')) {
    try {
      const terms = kw.split(/\s+/).slice(0, 3).join(' ');
      const r = await wp.browse('posts', { search: terms, per_page: 8, status: 'publish', context: 'view' });
      internalCandidates = r.items.map((p) => ({ title: p.title?.rendered || '', url: p.link })).filter((x) => x.url && x.url !== t.wp_url);
    } catch (e) { log.warn('postintel', `internal candidates failed: ${e.message}`); }
  }

  const myHeadings = headingsOf(t.content);
  const myWords = stripTags(t.content).split(/\s+/).filter(Boolean).length;
  const compBlock = scraped.length
    ? scraped.map((s, i) => `#${i + 1} ${s.url}\n   Title: ${s.title || '(none)'} (${s.wordCount} words)\n   Meta: ${s.metaDesc || '(none)'}\n   Headings: ${s.headings.slice(0, 25).join(' | ') || '(none)'}\n   Opening: ${s.excerpt.slice(0, 400)}`).join('\n\n')
    : (competitors.length ? `Top URLs: ${competitors.slice(0, 10).map((c) => c.url).join(', ')}` : '(no SERP data — use your knowledge of what ranks for this keyword)');
  const avgWords = scraped.length ? Math.round(scraped.reduce((n, s) => n + s.wordCount, 0) / scraped.length) : 0;

  const topic = cfg.get('site_topic') || cfg.get('brand_name') || 'this site';
  const out = await ai.json({
    system: `You are a senior SEO content strategist for ${topic}. You are given THIS page and the ACTUAL scraped content of the pages ranking in Google's top 10 for the focus keyword. Find exactly what the top results cover that THIS page does NOT, and give concrete, apply-ready EDIT instructions. No generic filler — every item must be specific to this keyword and these competitors.`,
    prompt: `Focus keyword: "${kw}".

THIS PAGE — title: "${t.title}" (${myWords} words)
THIS PAGE headings: ${myHeadings.join(' | ') || '(none yet)'}
THIS PAGE opening: ${stripTags(t.content).slice(0, 1500) || '(no content yet)'}

GOOGLE TOP-10 RANKING PAGES (scraped — average ${avgWords} words):
${compBlock}

EXISTING POSTS ON THIS SITE we could internally link FROM/TO:
${internalCandidates.map((c) => `- ${c.title}: ${c.url}`).join('\n') || '(none found)'}

Return JSON:
{
  "coverageScore": <0-100 estimate of how completely THIS page covers the topic vs the top 10>,
  "targetWordCount": <recommended word count to be competitive, based on the top 10 average>,
  "contentGaps": ["a specific subtopic/section the top pages cover that THIS page lacks (name the competitor angle)"],
  "improvements": [{"heading": "exact H2/H3 to ADD to this article", "what": "what to cover in it and why it matters for this keyword", "competitorsCovering": <how many of the top 10 cover this>, "priority": "high|medium|low"}],
  "missingEntities": ["important term/entity/tool/stat the top pages mention that THIS page omits"],
  "competitorsLack": ["what even the top pages miss — a concrete way THIS page can be MORE complete/better"],
  "hubPotential": {"canBeHub": true|false, "reason": "why / why not", "suggestedSpokes": ["specific supporting article title"]},
  "backlinkSteps": [{"tactic": "...", "step": "exact action for THIS post", "target": "who/where"}],
  "internalLinks": [{"toUrl": "one of the existing-post URLs above", "toTitle": "...", "anchor": "natural anchor text that fits THIS page", "why": "topical relevance"}]
}`,
    maxTokens: 3500,
  });

  const result = {
    target: { kind: t.kind, id: t.id, wp_url: t.wp_url },
    keyword: kw,
    title: t.title,
    myWordCount: myWords,
    avgCompetitorWords: avgWords,
    competitors: competitors.slice(0, 10),
    scraped: scraped.map((s) => ({ url: s.url, title: s.title, wordCount: s.wordCount })),
    scrapedCount: scraped.length,
    internalCandidates,
    ...out,
  };
  save(t.ref, t.kind, kw, result);
  log.info('postintel', `Analysed "${kw}": ${(out.contentGaps || []).length} gaps, ${(out.improvements || []).length} edits, ${scraped.length}/10 SERP pages scraped (saved)`);
  return result;
}

// Apply the analysis's improvements by EDITING the draft article: ask the AI to
// add the missing sections while preserving the existing content, then re-score.
export async function applyImprovements(articleId) {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  if (!a) throw new Error('Article not found');
  const stored = getLatest({ articleId });
  if (!stored) throw new Error('Run the analysis first, then apply.');
  const kw = a.focus_keyword || a.keyword;
  const edits = [
    ...(stored.improvements || []).map((i) => `ADD section "${i.heading}": ${i.what}`),
    ...(stored.contentGaps || []).map((g) => `COVER: ${g}`),
    ...(stored.missingEntities || []).length ? [`MENTION these where relevant: ${(stored.missingEntities || []).join(', ')}`] : [],
  ].filter(Boolean);
  if (!edits.length) throw new Error('No improvements to apply — the analysis found no gaps.');

  const result = await ai.doc({
    system: `You are an expert SEO editor. Improve the article by ADDING the missing sections/topics below so it out-covers the top-ranking pages — KEEP all existing valuable content and structure, do not remove the rich presentation blocks, and keep it accurate and human. Focus keyword: "${kw}". Output WordPress Gutenberg block markup.`,
    prompt: `Improve this article so it comprehensively covers "${kw}" and beats the current top 10.

ADD / IMPROVE (from the SERP content-gap analysis):
${edits.map((e, i) => `${i + 1}. ${e}`).join('\n')}
${stored.targetWordCount ? `\nAim for roughly ${stored.targetWordCount} words total (competitors average ${stored.avgCompetitorWords || '?'}).` : ''}

CURRENT ARTICLE (title: "${a.title}"):
${a.content}

Return the FULL improved article (keep what's good, weave in the additions naturally with proper H2/H3 sections and internal links).
${seo.OUTPUT_SPEC}`,
    maxTokens: 8000,
  });

  const content = result.content || a.content;
  const newStatus = a.status === 'published' ? a.status : 'pending_review';
  db.prepare("UPDATE articles SET content=?, status=?, updated_at=datetime('now') WHERE id=?").run(content, newStatus, articleId);
  let score = a.seo_score;
  try { score = seo.score({ title: a.title, slug: a.slug, content, metaDescription: a.meta_description, focusKeyword: kw }).score; db.prepare('UPDATE articles SET seo_score=? WHERE id=?').run(score, articleId); } catch { /* */ }
  log.info('postintel', `Applied ${edits.length} improvements to article #${articleId} (new score ${score})`);
  return { ok: true, applied: edits.length, seo_score: score };
}

// Deterministically insert internal links into a draft or a live post.
export async function insertInternalLinks(target, links = []) {
  const t = await resolveTarget(target);
  let content = t.content || '';
  const related = [];
  let inlined = 0;
  for (const l of links) {
    if (!l.toUrl || !l.anchor) continue;
    const esc = l.anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(>[^<]*?)\\b(${esc})\\b`, 'i');
    if (re.test(content) && !content.includes(`href="${l.toUrl}"`)) {
      content = content.replace(re, (m, pre, word) => `${pre}<a href="${l.toUrl}">${word}</a>`);
      inlined++;
    } else if (!content.includes(`href="${l.toUrl}"`)) {
      related.push(l);
    }
  }
  if (related.length) {
    content += `\n\n<!-- wp:heading -->\n<h2>Related articles</h2>\n<!-- /wp:heading -->\n<!-- wp:list -->\n<ul>${related.map((l) => `<li><a href="${l.toUrl}">${l.anchor || l.toTitle || l.toUrl}</a></li>`).join('')}</ul>\n<!-- /wp:list -->`;
  }
  if (t.kind === 'article') {
    db.prepare("UPDATE articles SET content=?, updated_at=datetime('now') WHERE id=?").run(content, t.id);
    if (t.wp_post_id) { try { await wp.updatePost(t.wp_post_id, { content }); } catch (e) { log.warn('postintel', `WP update failed: ${e.message}`); } }
  } else {
    if (t.postType === 'pages') await wp.updatePage(t.id, { content });
    else await wp.updatePost(t.id, { content });
  }
  log.info('postintel', `Inserted ${inlined} inline + ${related.length} related links into ${t.kind} #${t.id}`);
  return { inlined, related: related.length, total: inlined + related.length };
}

export default { analyze, getLatest, applyImprovements, insertInternalLinks };
