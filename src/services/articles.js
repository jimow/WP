// Article generation + publishing. The AI writes an SEO article as Gutenberg
// block markup with internal links to its hub/sibling spokes. Drafts land in
// status 'pending_review'; on approval they are pushed to WordPress.
import db from '../db.js';
import ai from '../clients/ai.js';
import wp from '../clients/wp.js';
import cfg from '../config.js';
import log from '../log.js';
import seo from './seo.js';
import kwindex from './kwindex.js';
import themeintel from './themeintel.js';
import indexmon from './indexmon.js';
import interlink from './interlink.js';
import distribute from './distribute.js';

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 70);

// Has this focus keyword been used on another of our articles OR a live post?
function kwUsedElsewhere(keyword, exceptId) {
  if (!keyword) return false;
  const row = db.prepare(
    "SELECT COUNT(*) n FROM articles WHERE lower(COALESCE(focus_keyword, keyword)) = lower(?) AND id != ?"
  ).get(keyword, exceptId || 0);
  if (row.n > 0) return true;
  // Also check the live-site keyword index (excludes our own article entry).
  const m = kwindex.check(keyword);
  return !!(m.exists && m.match && m.match.source !== 'article');
}

function clusterContext(article) {
  if (!article.cluster_id) return { hub: null, siblings: [] };
  const items = db.prepare('SELECT keyword, role FROM cluster_items WHERE cluster_id = ?').all(article.cluster_id);
  const hub = items.find((i) => i.role === 'hub')?.keyword || null;
  const siblings = items.filter((i) => i.role === 'spoke' && i.keyword !== article.keyword).map((i) => i.keyword);
  // Already-published siblings we can link to with real URLs.
  const published = db.prepare(
    "SELECT keyword, wp_url FROM articles WHERE cluster_id = ? AND wp_url IS NOT NULL AND id != ?"
  ).all(article.cluster_id, article.id);
  return { hub, siblings, published };
}

export async function generate(articleId, options = {}) {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  if (!a) throw new Error(`Article ${articleId} not found`);
  db.prepare("UPDATE articles SET status='generating', error=NULL, updated_at=datetime('now') WHERE id=?").run(articleId);

  try {
    const { hub, siblings, published } = clusterContext(a);
    const brand = cfg.get('brand_name');
    const topic = cfg.get('site_topic');
    // Per-article options override the global defaults (the user is in control).
    const tone = options.tone || cfg.get('tone');
    const wmin = options.words_min ? parseInt(options.words_min, 10) : cfg.getInt('words_min', 1200);
    const wmax = options.words_max ? parseInt(options.words_max, 10) : cfg.getInt('words_max', 1800);
    // Rich visual presentation (callouts, key-takeaways, cards, related-links…),
    // accented with the live theme's primary colour so it harmonises once published.
    const tp = themeintel.profile();
    const themePri = (tp?.palette || []).find((c) => /primary|accent|brand/i.test(c.name))?.hex || tp?.tokens?.colors?.[0] || '#2563eb';
    const richKit = cfg.getBool('rich_presentation') ? seo.presentationKit(themePri) : '';

    // Real, WORKING internal links: cluster siblings first, then live posts on the
    // site that match the topic (so links aren't dead "#" placeholders).
    const realLinks = [...(published || [])];
    const seenUrls = new Set(realLinks.map((r) => r.wp_url));
    if (realLinks.length < 4 && (cfg.get('wp_base_url') && cfg.get('wp_app_password'))) {
      try {
        const terms = (a.keyword || '').split(/\s+/).slice(0, 3).join(' ');
        const res = await wp.browse('posts', { search: terms, per_page: 6, status: 'publish', context: 'view' });
        for (const p of res.items) {
          const url = p.link;
          if (url && !seenUrls.has(url)) { realLinks.push({ keyword: p.title?.rendered || p.title?.raw || url, wp_url: url }); seenUrls.add(url); }
        }
      } catch (e) { log.warn('articles', `internal-link lookup failed: ${e.message}`); }
    }
    const wantInternal = cfg.getInt('seo_internal_links', 3);
    const linkHints = realLinks.length
      ? `Internal links — you MUST add ${Math.max(2, wantInternal)} WORKING internal links using these EXACT existing-post URLs (real <a href>, never "#"):\n${realLinks.slice(0, 8).map((p) => `- ${p.keyword}: ${p.wp_url}`).join('\n')}\nChoose the most contextually relevant ones and link with natural anchor text.`
      : `Add ${Math.max(2, wantInternal)} internal links as <a href="#">descriptive anchor</a> (no existing posts found to link to yet).`;

    // Per-article directives (length / angle / extra instructions) — take priority.
    const overrides = [];
    if (options.words_min || options.words_max) overrides.push(`Target length: ${wmin}-${wmax} words.`);
    if (options.angle) overrides.push(`Angle / search intent for THIS article: ${options.angle}.`);
    if (options.instructions) overrides.push(`Extra instructions for THIS article: ${options.instructions}`);
    const overridesBlock = overrides.length ? `\n\nPER-ARTICLE REQUIREMENTS (these take priority):\n${overrides.map((o) => `- ${o}`).join('\n')}` : '';

    const system = `You are an expert SEO writer for ${brand || topic || 'a niche website'}. Write original, accurate, genuinely useful content that satisfies Google's helpful-content guidelines and scores 90+ on Rank Math's on-page SEO analysis. Tone: ${tone}. Output WordPress Gutenberg block markup (HTML comment wrappers like <!-- wp:heading --> ... <!-- /wp:heading -->).`;

    const result = await ai.doc({
      system,
      prompt: `Write a ${a.role === 'hub' ? 'comprehensive pillar/hub' : 'focused supporting'} article. Focus keyword: "${a.keyword}".
${hub && a.role === 'spoke' ? `It belongs to the "${hub}" topic cluster and MUST link up to the hub and relevant siblings.` : ''}
${a.role === 'hub' ? 'As the pillar, broadly cover the topic and link DOWN to each spoke subtopic.' : ''}

Follow EVERY Rank Math SEO requirement below:
${seo.requirements({ words_min: wmin, words_max: wmax })}

${linkHints}${overridesBlock}
${themeintel.designGuidance()}
${richKit}

${seo.OUTPUT_SPEC}`,
      maxTokens: 8000,
    });

    let focus = (result.focus_keyword || a.keyword).toLowerCase().trim();
    let usedBefore = kwUsedElsewhere(focus, articleId);
    // If the AI drifted to a focus keyword that's already covered but the original
    // seed keyword is still unique, prefer the seed (avoids accidental cannibalisation).
    const seedKw = (a.keyword || '').toLowerCase().trim();
    if (usedBefore && focus !== seedKw && !kwUsedElsewhere(seedKw, articleId)) {
      focus = seedKw;
      usedBefore = false;
    }
    // CONFIRM-before-adopt: if the focus keyword still looks already-used, flag it
    // (surfaced in the UI; blocks auto-publish) rather than silently cannibalising.
    let kwWarning = null;
    if (usedBefore) {
      const m = kwindex.check(focus);
      const where = m.match && m.match.url ? ` — already at ${m.match.url}` : '';
      kwWarning = `Focus keyword "${focus}" appears already used${where}. Confirm before publishing to avoid keyword cannibalisation (or change the focus keyword / merge with the existing post).`;
      log.warn('articles', kwWarning);
    }
    const normalize = (r) => ({
      title: r.title || a.keyword,
      slug: r.slug || slugify(r.title || a.keyword),
      meta_description: r.meta_description || '',
      excerpt: r.excerpt || '',
      content: r.content || '',
      focus_keyword: focus,
      tags: Array.isArray(r.tags) ? r.tags.join(',') : (r.tags || ''),
      faq: r.faq ? JSON.stringify(r.faq) : null,
      image_alts: r.image_alts ? JSON.stringify(r.image_alts) : null,
    });
    const scoreOf = (d) => seo.score({ title: d.title, slug: d.slug, content: d.content, metaDescription: d.meta_description, focusKeyword: focus, kwUsedBefore: usedBefore });

    // Cross-check against the Rank Math criteria and self-correct until the
    // owner's target score is met (or attempts run out). Keeps the best draft.
    let best = normalize(result);
    let report = scoreOf(best);
    const target = cfg.getInt('seo_min_score', 80);
    const maxFix = cfg.getInt('seo_max_fix_attempts', 2);
    // Density band + concrete keyword RANGE (floor+ceiling) so we DETECT and FIX
    // both stuffing AND under-use — sized to the article's ACTUAL word count.
    const densTarget = parseFloat(cfg.get('seo_keyword_density')) || 1.1;
    const densMin = parseFloat(cfg.get('seo_density_min')) || 1.0;
    const densMax = parseFloat(cfg.get('seo_density_max')) || 1.2;
    const kwRange = (words) => { const lo = Math.max(8, Math.ceil((densMin / 100) * (words || wmax))); const hi = Math.max(lo + 2, Math.floor((densMax / 100) * (words || wmax))); return { lo, hi, mid: Math.round((lo + hi) / 2) }; };
    const densityHigh = (r) => r.density > densMax;
    const densityLow = (r) => r.words > 300 && r.density < densMin;
    const needsFix = (r) => r.score < target || r.words < wmin || densityHigh(r) || densityLow(r);
    // Density correction needs a couple of passes to land in a tight band.
    const maxFixEff = Math.max(maxFix, (densityHigh(report) || densityLow(report)) ? 3 : maxFix);
    let attempts = 0;
    // Iterate while score/length/DENSITY are out of bounds (density both ways).
    while (needsFix(report) && attempts < maxFixEff) {
      attempts++;
      const failing = report.checks.filter((c) => !c.pass).map((c) => `- ${c.group}: ${c.label}`).join('\n');
      const tooShort = report.words < wmin ? `\n- LENGTH: only ${report.words} words — expand to at least ${wmin} words with genuinely useful detail (examples, edge cases, deeper explanation), not filler.` : '';
      const { lo, hi, mid } = kwRange(report.words);
      const densNote = densityHigh(report)
        ? `\n- KEYWORD STUFFING — the exact focus keyword appears ${report.kwCount} times (${report.density}%, max ${densMax}%). REDUCE to between ${lo} and ${hi} exact uses (aim ~${mid}) by swapping some for synonyms/pronouns. Keep the same length and information.`
        : (densityLow(report) ? `\n- KEYWORD DENSITY TOO LOW — the exact focus keyword appears only ${report.kwCount} times (${report.density}%, min ${densMin}%). INCREASE to between ${lo} and ${hi} exact uses (aim ~${mid}): add the EXACT phrase to 2-3 subheadings, the image alt, the first and last paragraph, and naturally through the body. This is REQUIRED.` : '');
      try {
        const fix = await ai.doc({
          system,
          prompt: `This article scored ${report.score}/100 on the Rank Math on-page checklist (target ≥ ${target}). Revise it to PASS the failing tests below WITHOUT breaking the passing ones. Keep keyword density in the ${densMin}-${densMax}% band (the EXACT focus keyword used between ${lo} and ${hi} times, aim ~${mid}). Keep it accurate, human and useful.${richKit ? ' KEEP and enhance the rich visual components (Quick Answer, Key Takeaways, tip/warning callouts, stat/step cards, pull quote, “Keep reading” related-links card) — do not strip them.' : ''}

Failing tests:
${failing}${tooShort}${densNote}

CURRENT TITLE: ${best.title}
CURRENT META: ${best.meta_description}
CURRENT CONTENT (improve this; raw markup follows):
${best.content}

Return the FULL improved article in the SAME two-block format:
${seo.OUTPUT_SPEC}`,
          maxTokens: 8000,
        });
        const cand = normalize(fix);
        const candReport = scoreOf(cand);
        const inBand = (r) => !densityHigh(r) && !densityLow(r);
        // Accept if it lands the density in-band, OR moves it the right way without
        // dropping the score. (For low density we WANT a higher-density candidate.)
        const densBetter = inBand(candReport)
          || (densityHigh(report) ? candReport.density < report.density
            : densityLow(report) ? candReport.density > report.density : true);
        const fixingDensity = densityHigh(report) || densityLow(report);
        if (densBetter && (candReport.score >= report.score || (fixingDensity && inBand(candReport) && candReport.score >= target))) { best = cand; report = candReport; }
        if (!needsFix(report)) break;
      } catch (e) {
        log.warn('articles', `SEO fix pass ${attempts} failed: ${e.message}`);
        break;
      }
    }

    db.prepare(`UPDATE articles SET
        title=@title, slug=@slug, meta_description=@meta_description, excerpt=@excerpt,
        content=@content, focus_keyword=@focus_keyword, tags=@tags, faq=@faq,
        image_alts=@image_alts, seo_score=@score, kw_warning=@kw_warning, status='pending_review', updated_at=datetime('now')
      WHERE id=@id`).run({ id: articleId, ...best, score: report.score, kw_warning: kwWarning });
    log.info('articles', `Generated "${best.title}" (Rank Math ${report.score}/100, density ${report.density}%, ${report.kwCount} kw uses, ${report.words} words, ${attempts} fix pass(es))${kwWarning ? ' ⚠ kw-warning' : ''} for "${a.keyword}"`);
    return db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  } catch (e) {
    db.prepare("UPDATE articles SET status='failed', error=?, updated_at=datetime('now') WHERE id=?").run(e.message, articleId);
    log.error('articles', `Generation failed for #${articleId}: ${e.message}`);
    throw e;
  }
}

// Build JSON-LD structured-data blocks (Article + FAQPage + optional HowTo) as
// wp:html script blocks appended to the content. Rich results work even if the
// SEO plugin's schema isn't configured.
function buildSchemaBlocks(a, { description = '', image = '' } = {}) {
  const blocks = [];
  const ld = (obj) => `\n\n<!-- wp:html -->\n<script type="application/ld+json">${JSON.stringify(obj)}</script>\n<!-- /wp:html -->`;
  const author = cfg.get('author_name') || cfg.get('brand_name') || undefined;
  const brand = cfg.get('brand_name') || undefined;
  // Article / BlogPosting
  const article = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: a.title || a.keyword,
    description: description || undefined,
    keywords: a.focus_keyword || a.keyword,
    datePublished: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  };
  if (image) article.image = image;
  if (author) article.author = { '@type': 'Person', name: author };
  if (brand) article.publisher = { '@type': 'Organization', name: brand };
  blocks.push(ld(article));
  // FAQPage from the stored faq field
  try {
    const faq = a.faq ? JSON.parse(a.faq) : [];
    const valid = (Array.isArray(faq) ? faq : []).filter((f) => f && f.q && f.a);
    if (valid.length) {
      blocks.push(ld({
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: valid.map((f) => ({ '@type': 'Question', name: String(f.q), acceptedAnswer: { '@type': 'Answer', text: String(f.a) } })),
      }));
    }
  } catch { /* ignore bad faq json */ }
  // HowTo for step-by-step guides (detected from the title)
  if (/^how to\b|step[- ]by[- ]step|\bguide\b/i.test(a.title || '')) {
    const steps = [...String(a.content || '').matchAll(/<h[23][^>]*>\s*(?:step\s*\d+[:.\)]?\s*)?([^<]{4,90})<\/h[23]>/gi)].map((m) => m[1].trim()).slice(0, 8);
    if (steps.length >= 3) {
      blocks.push(ld({
        '@context': 'https://schema.org', '@type': 'HowTo',
        name: a.title, step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s })),
      }));
    }
  }
  return blocks.join('');
}

// Push an approved article to WordPress. `options` carries per-publish appearance
// overrides chosen in the UI (status, schedule, category, template, theme layout
// meta, comments, featured image) — all sourced live from the connected theme.
export async function publish(articleId, { scheduledDate = null, confirm = false, options = {} } = {}) {
  const opt = options || {};
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  if (!a) throw new Error(`Article ${articleId} not found`);
  if (!a.content) throw new Error('Article has no content yet.');
  // CONFIRM-before-adopt: refuse to publish a flagged duplicate-keyword article
  // until the owner explicitly confirms (the UI prompts, then retries with confirm).
  if (a.kw_warning && !confirm) {
    const err = new Error(`DUPLICATE_KW: ${a.kw_warning}`);
    err.code = 'DUPLICATE_KW';
    throw err;
  }
  if (a.kw_warning && confirm) db.prepare('UPDATE articles SET kw_warning=NULL WHERE id=?').run(articleId);
  db.prepare("UPDATE articles SET status='publishing', error=NULL WHERE id=?").run(articleId);

  try {
    // Resolve the schedule + status. A schedule can come from the editorial
    // calendar (scheduledDate) OR the publish-options modal (status='future').
    const schedDate = scheduledDate || (opt.status === 'future' ? opt.scheduledDate : null);
    const wpStatus = opt.status ? opt.status
      : (schedDate ? 'future' : (cfg.get('publish_status') === 'draft' ? 'draft' : 'publish'));
    // Category: an explicit pick from the modal wins over the configured default.
    const categories = [];
    if (opt.categoryId) {
      categories.push(Number(opt.categoryId));
    } else if (cfg.get('default_category')) {
      const id = await wp.ensureCategory(cfg.get('default_category'));
      if (id) categories.push(id);
    }
    // Resolve tag names → ids.
    const tags = [];
    for (const name of (a.tags || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      try { const id = await wp.ensureTag(name); if (id) tags.push(id); } catch { /* skip */ }
    }
    // Generate the AI image FIRST so we can (a) set it as featured and (b) put a
    // real in-content image with the focus keyword as alt text — satisfying Rank
    // Math's "image with Focus Keyword as alt" criterion on the live post.
    let content = a.content;
    let featuredMediaId = null;
    const alt = a.focus_keyword || a.keyword;

    // Resolve a real, working hero image (satisfies the keyword-alt + rich-media
    // Rank Math tests): 1) AI-generate if enabled, else 2) reuse an existing media
    // library image matching the keyword, else 3) strip the placeholder.
    // Featured image: modal can force ('auto') or skip ('none'); else use the setting.
    const wantImage = opt.featuredImage === 'none' ? false
      : opt.featuredImage === 'auto' ? true : cfg.getBool('auto_featured_image');
    let heroUrl = null;
    if (wantImage) {
      try {
        const brand = cfg.get('brand_name') || cfg.get('site_topic') || '';
        const img = await ai.generateImage({ prompt: `Professional, clean blog header image for an article titled "${a.title}". Topic: ${alt}. ${brand ? `Brand context: ${brand}.` : ''} Modern, high quality, no text overlay.` });
        const media = await wp.uploadMedia(img.bytes, { filename: `${(a.slug || a.keyword).slice(0, 50)}.png`, contentType: img.contentType, alt, title: a.title });
        featuredMediaId = media.id; heroUrl = media.source_url;
        log.info('articles', `Generated featured image #${media.id} for #${articleId}`);
      } catch (e) { log.warn('articles', `Image generation failed: ${e.message}`); }
    }
    if (!heroUrl && wantImage) {
      try {
        const media = await wp.listMedia({ search: alt, per_page: 5, media_type: 'image' });
        const hit = (media || []).find((m) => m.source_url);
        if (hit) { featuredMediaId = hit.id; heroUrl = hit.source_url; log.info('articles', `Reused existing media #${hit.id} for #${articleId}`); }
      } catch (e) { log.warn('articles', `Media lookup failed: ${e.message}`); }
    }
    if (heroUrl) {
      const block = `<!-- wp:image {"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="${heroUrl}" alt="${alt}"/></figure>\n<!-- /wp:image -->\n\n`;
      content = content.includes('{{HERO_IMAGE}}') ? content.replace(/\{\{HERO_IMAGE\}\}/g, heroUrl) : block + content;
    } else {
      content = content.replace(/\{\{HERO_IMAGE\}\}/g, '');
    }

    // ---- Structured data (JSON-LD) — injected into the body so rich results
    // work regardless of SEO-plugin config. Article + FAQPage (+ HowTo for guides).
    const descEarly = a.meta_description || a.excerpt || '';
    if (cfg.getBool('inject_schema')) {
      try { content += buildSchemaBlocks(a, { description: descEarly, image: heroUrl }); }
      catch (e) { log.warn('articles', `schema build failed: ${e.message}`); }
    }

    // ---- Fill EVERY field: SEO + social + schema + theme layout --------------
    const focus = a.focus_keyword || a.keyword;
    const desc = a.meta_description || a.excerpt || '';
    const meta = {};
    if (cfg.getBool('rankmath_meta')) {
      // Rank Math on-page
      meta.rank_math_focus_keyword = focus;
      meta.rank_math_title = a.title;
      meta.rank_math_description = desc;
      meta.rank_math_pillar_content = a.role === 'hub' ? 'on' : 'off';
      // Schema / rich snippet (Article).
      meta.rank_math_rich_snippet = 'article';
      meta.rank_math_snippet_article_type = 'BlogPosting';
      // Open Graph (Facebook) + Twitter — reuse the SEO title/description + hero.
      meta.rank_math_facebook_title = a.title;
      meta.rank_math_facebook_description = desc;
      meta.rank_math_twitter_title = a.title;
      meta.rank_math_twitter_description = desc;
      if (heroUrl) { meta.rank_math_facebook_image = heroUrl; meta.rank_math_twitter_image = heroUrl; }
      if (categories[0]) meta.rank_math_primary_category = String(categories[0]);
    }
    // Theme per-post layout — owner defaults first, then per-publish overrides
    // chosen in the publish-options modal (keys discovered from the live theme).
    if (cfg.get('post_sidebar_layout')) meta['site-sidebar-layout'] = cfg.get('post_sidebar_layout');
    if (cfg.get('post_content_layout')) meta['site-content-layout'] = cfg.get('post_content_layout');
    if (opt.layoutMeta && typeof opt.layoutMeta === 'object') {
      for (const [k, v] of Object.entries(opt.layoutMeta)) { if (v) meta[k] = v; }
    }

    const body = {
      title: a.title, content, excerpt: desc, slug: a.slug, status: wpStatus,
      tags, meta, comment_status: opt.commentStatus || 'open', format: opt.format || 'standard',
    };
    if (schedDate) body.date = schedDate;
    if (opt.template) body.template = opt.template;
    let post;
    if (a.wp_post_id) post = await wp.updatePost(a.wp_post_id, body);
    else post = await wp.createPost({ ...body, categories });

    if (featuredMediaId) {
      try { await wp.setFeaturedImage(post.id, featuredMediaId); } catch (e) { log.warn('articles', `setFeatured failed: ${e.message}`); }
    }

    if (schedDate) {
      // WordPress now owns the future-dated post; track it as scheduled locally.
      db.prepare("UPDATE articles SET status='scheduled', scheduled_for=?, wp_post_id=?, wp_url=?, updated_at=datetime('now') WHERE id=?")
        .run(schedDate, post.id, post.link, articleId);
      log.info('articles', `Scheduled "${a.title}" for ${schedDate} → ${post.link}`);
    } else {
      db.prepare("UPDATE articles SET status='published', wp_post_id=?, wp_url=?, published_at=COALESCE(published_at, datetime('now')), updated_at=datetime('now') WHERE id=?")
        .run(post.id, post.link, articleId);
      // Post-publish automations (all best-effort, each gated by its own setting):
      // tell Google to crawl it, weave internal links, announce to the share hook.
      indexmon.submit(post.link).catch(() => {});
      if (cfg.getBool('auto_interlink')) interlink.autoLinkArticle(articleId).catch(() => {});
      distribute.onPublish({ title: a.title, url: post.link, excerpt: desc, image: heroUrl || '' }).catch(() => {});
    }
    kwindex.add(a.focus_keyword || a.keyword, post.link); // keep the dedup index fresh
    // Link the cluster item to this article id.
    db.prepare('UPDATE cluster_items SET article_id=? WHERE cluster_id=? AND keyword=?')
      .run(articleId, a.cluster_id, a.keyword);
    log.info('articles', `Published "${a.title}" → ${post.link}`);
    return post;
  } catch (e) {
    db.prepare("UPDATE articles SET status='approved', error=? WHERE id=?").run(e.message, articleId);
    log.error('articles', `Publish failed for #${articleId}: ${e.message}`);
    throw e;
  }
}

export function list({ status, clusterId, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (clusterId) { where.push('cluster_id = ?'); params.push(clusterId); }
  const sql = `SELECT id, cluster_id, keyword, focus_keyword, title, slug, role, status, seo_score, wp_url, scheduled_for, kw_warning, error, updated_at
    FROM articles ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function get(id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

// Recompute the Rank Math-style checklist for an article (used in the review UI).
export function seoReport(id) {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!a) throw new Error('Article not found');
  const report = seo.score({
    title: a.title || '', slug: a.slug || '', content: a.content || '',
    metaDescription: a.meta_description || '', focusKeyword: a.focus_keyword || a.keyword,
    kwUsedBefore: kwUsedElsewhere(a.focus_keyword || a.keyword, id),
  });
  db.prepare('UPDATE articles SET seo_score=? WHERE id=?').run(report.score, id);
  return report;
}

export function update(id, fields) {
  const allowed = ['title', 'slug', 'content', 'excerpt', 'meta_description', 'focus_keyword', 'tags', 'status', 'scheduled_for'];
  const sets = [], params = [];
  for (const k of allowed) if (k in fields) { sets.push(`${k}=?`); params.push(fields[k]); }
  if (!sets.length) return;
  sets.push("updated_at=datetime('now')");
  params.push(id);
  db.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id=?`).run(...params);
}

export function setStatus(id, status) {
  db.prepare("UPDATE articles SET status=?, updated_at=datetime('now') WHERE id=?").run(status, id);
}

// Clone an article into a new editable draft (handy for variations / A-B angles).
export function duplicate(id) {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!a) throw new Error('Article not found');
  const status = a.content ? 'pending_review' : 'idea';
  const info = db.prepare(`INSERT INTO articles
      (cluster_id, keyword, title, slug, content, excerpt, meta_description, role, status, focus_keyword, tags, faq, image_alts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    a.cluster_id, `${a.keyword} (copy)`, a.title ? `${a.title} (copy)` : null,
    a.slug ? `${a.slug}-copy` : null, a.content, a.excerpt, a.meta_description,
    a.role, status, a.focus_keyword, a.tags, a.faq, a.image_alts,
  );
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(info.lastInsertRowid);
}

// Owner confirms a flagged duplicate-keyword article is OK to adopt (clears the flag).
export function confirmKeyword(id) {
  db.prepare("UPDATE articles SET kw_warning=NULL, updated_at=datetime('now') WHERE id=?").run(id);
  return { ok: true };
}

export function remove(id) {
  db.prepare('DELETE FROM articles WHERE id = ?').run(id);
}

// Analyse an uploaded keyword list BEFORE creating anything: group the
// same/similar ones into a single representative (anti-cannibalisation) and flag
// which are already covered by existing content. Returns a reviewable plan:
//   { total, create:[{keyword,volume,merged:[...]}], existing:[{keyword,url,source,merged}], mergedGroups }
export function analyzeKeywords(keywords = []) {
  const items = keywords
    .map((k) => (typeof k === 'object' && k ? { keyword: String(k.keyword || '').trim(), volume: +k.volume || 0 } : { keyword: String(k || '').trim(), volume: 0 }))
    .filter((i) => i.keyword.length >= 2);

  // 1) Group same/similar keywords; representative = highest volume (else first).
  const groups = [];
  for (const it of items) {
    const g = groups.find((g) => g.members.some((m) => kwindex.similar(m.keyword, it.keyword)));
    if (g) { g.members.push(it); if (it.volume > g.volume) { g.volume = it.volume; g.rep = it.keyword; } }
    else groups.push({ rep: it.keyword, volume: it.volume, members: [it] });
  }

  // 2) Classify each group: already covered on the site / in the queue, or new.
  const create = [];
  const existing = [];
  let mergedGroups = 0;
  for (const g of groups) {
    const merged = g.members.map((m) => m.keyword).filter((k) => k !== g.rep);
    if (merged.length) mergedGroups++;
    const dupLocal = db.prepare('SELECT wp_url FROM articles WHERE lower(COALESCE(focus_keyword, keyword)) = lower(?) LIMIT 1').get(g.rep);
    const m = kwindex.check(g.rep);
    if (dupLocal || m.exists) {
      existing.push({ keyword: g.rep, url: (m.match && m.match.url) || (dupLocal && dupLocal.wp_url) || null, source: dupLocal ? 'your queue' : (m.match && m.match.source) || 'site', merged });
    } else {
      create.push({ keyword: g.rep, volume: g.volume, merged });
    }
  }
  return { total: items.length, groups: groups.length, mergedGroups, create, existing };
}

// Create many STANDALONE article ideas (no cluster) from a keyword list, skipping
// any that are the same OR similar to an existing keyword/post (exact + fuzzy via
// kwindex) and de-duplicating within the batch. Returns { created, skipped }.
export function addIdeasBulk(keywords = []) {
  const created = [];
  const skipped = [];
  const seen = new Set();
  const tx = db.transaction((list) => {
    for (const raw of list) {
      const kw = String(raw && raw.keyword ? raw.keyword : raw || '').trim();
      if (!kw || kw.length < 2) continue;
      const n = kwindex.simKey(kw);
      if (seen.has(n)) { skipped.push(kw); continue; }   // same/similar within this upload
      seen.add(n);
      // Same/similar to something already covered on the site or in our queue?
      const dupLocal = db.prepare('SELECT 1 FROM articles WHERE lower(COALESCE(focus_keyword, keyword)) = lower(?) LIMIT 1').get(kw);
      if (dupLocal || kwindex.check(kw).exists) { skipped.push(kw); continue; }
      const info = db.prepare("INSERT INTO articles(keyword, role, status) VALUES(?, 'spoke', 'idea')").run(kw);
      created.push({ id: info.lastInsertRowid, keyword: kw });
    }
  });
  tx(keywords);
  log.info('articles', `Bulk ideas: +${created.length} created, ${skipped.length} skipped (dup/similar)`);
  return { created, skipped };
}

// Manual idea entry (optionally attached to a cluster).
export function addIdea(keyword, role = 'spoke', clusterId = null) {
  const info = db.prepare("INSERT INTO articles(keyword, role, status, cluster_id) VALUES(?, ?, 'idea', ?)")
    .run(keyword, role, clusterId || null);
  if (clusterId) {
    try { db.prepare('INSERT INTO cluster_items(cluster_id, keyword, role) VALUES(?, ?, ?)').run(clusterId, keyword, role); } catch { /* ignore dup */ }
  }
  return info.lastInsertRowid;
}

export default { generate, publish, duplicate, list, get, seoReport, update, setStatus, confirmKeyword, remove, addIdea, addIdeasBulk, analyzeKeywords };
