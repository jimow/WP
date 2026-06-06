// Page & layout management. The agent can design new pages (hub/pillar pages,
// landing pages) as Gutenberg layouts and propose updates to existing pages.
// Everything is a draft pending review unless autonomy is full_auto.
import db from '../db.js';
import ai from '../clients/ai.js';
import wp from '../clients/wp.js';
import cfg from '../config.js';
import log from '../log.js';
import themeintel from './themeintel.js';

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 70);

// Standard, COMPLETE section blueprint per page type (so pages aren't thin).
const PAGE_SECTIONS = {
  landing: 'a strong hero (cover block: headline + subheadline + primary CTA button), a 3-column benefits/features section, a "how it works" steps section, a social-proof / testimonial section, an FAQ, and a final call-to-action band',
  homepage: 'a hero, key value-proposition columns, a featured topics/categories grid, an about teaser, a "latest / featured content" area, and a closing CTA',
  about: 'a hero, mission/story, "what we do" columns, our values, an author/team section, and a CTA',
  services: 'a hero, a services grid (columns/cards), a process-steps section, a "why choose us" section, a testimonial, and a pricing or CTA section',
  contact: 'a hero, a short intro, contact details, a contact-form placeholder block, and an FAQ',
  hub: 'a hero introducing the pillar topic, a topic overview, a clearly linked list/grid of every supporting spoke article, a "key concepts" section, and a CTA to explore',
  standard: 'a hero, 2-4 well-structured content sections, and a call-to-action',
};

// Design a brand-new, COMPLETE page using the active theme's design + patterns.
export async function design({ title, kind = 'landing', brief = '', clusterId } = {}) {
  const brand = cfg.get('brand_name');
  const topic = cfg.get('site_topic');
  let clusterBlurb = '';
  if (clusterId) {
    const items = db.prepare('SELECT keyword, role FROM cluster_items WHERE cluster_id = ?').all(clusterId);
    const spokeRows = db.prepare("SELECT keyword, wp_url FROM articles WHERE cluster_id = ? AND role='spoke'").all(clusterId);
    const links = spokeRows.map((s) => `${s.keyword}${s.wp_url ? ` (${s.wp_url})` : ''}`).join(', ');
    clusterBlurb = `This is the HUB/pillar page for a topic cluster. Hub topic: "${items.find((i) => i.role === 'hub')?.keyword}". Introduce the topic comprehensively and link DOWN to each supporting spoke article (use real URLs where given): ${links || items.filter((i) => i.role === 'spoke').map((i) => i.keyword).join(', ')}.`;
  }
  const sections = PAGE_SECTIONS[kind] || PAGE_SECTIONS.standard;

  const result = await ai.json({
    system: `You are a senior web designer + conversion copywriter building COMPLETE WordPress pages with native Gutenberg core blocks (wp:cover, wp:columns, wp:column, wp:group, wp:media-text, wp:buttons, wp:button, wp:heading, wp:paragraph, wp:list, wp:image, wp:separator, wp:spacer). Produce valid, complete block markup with the HTML comment wrappers and block attributes. Make it look professional and finished — not a stub.`,
    prompt: `Build a COMPLETE ${kind} page titled "${title}" for ${brand || topic || 'this site'}.
${brief ? `Brief: ${brief}` : ''}
${clusterBlurb}

The page MUST include ALL of these sections, fully written (real, on-brand copy — no lorem ipsum, no "[placeholder]"): ${sections}.
Use generous structure (groups/columns/spacers), clear visual hierarchy, and real CTAs. Wrap sections in <!-- wp:group --> with appropriate background where it helps.
${themeintel.designGuidance()}
${themeintel.patternsContext()}

Return JSON:
{"title":"...","slug":"...","metaDescription":"<155 chars>","content":"<full, complete Gutenberg block markup>"}`,
    maxTokens: 9000,
  });

  const info = db.prepare(
    "INSERT INTO pages(title, slug, kind, content, status) VALUES(?, ?, ?, ?, 'pending_review')"
  ).run(result.title || title, result.slug || slugify(title), kind, result.content);
  log.info('pages', `Designed complete ${kind} page "${title}" (pending review)`);
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(info.lastInsertRowid);
}

// Replicate an uploaded design image (mockup, screenshot, competitor page) as
// native Gutenberg blocks — AI sees the image and produces a layout that
// matches its sections, hierarchy, copy structure and visual emphasis, while
// applying the active theme's palette/fonts/container (via themeintel).
export async function replicate({ imageBase64, mimeType = 'image/png', title = 'Untitled design', kind = 'standard', notes = '' } = {}) {
  if (!imageBase64) throw new Error('No image provided.');
  const brand = cfg.get('brand_name');
  const topic = cfg.get('site_topic');
  const result = await ai.jsonFromImage({
    system: 'You are a senior web designer + Gutenberg expert. You can SEE the uploaded design and must reproduce its STRUCTURE, sections, layout grid, hierarchy and copy in native core Gutenberg blocks (wp:cover, wp:columns/column, wp:group, wp:media-text, wp:buttons/button, wp:heading, wp:paragraph, wp:list, wp:image, wp:separator, wp:spacer). Match the section order, column counts, CTA placement, and approximate proportions. Use REAL on-brand copy (transcribe headings/CTAs visible in the design; flesh out body text where the image only shows placeholders). Never output lorem/placeholder text. Output valid block markup with HTML comment wrappers.',
    prompt: `Reproduce the uploaded design as a COMPLETE WordPress ${kind} page titled "${title}" for ${brand || topic || 'this site'}.
${notes ? `Additional notes from the user: ${notes}` : ''}

Pay attention to: section order, column ratios, hero treatment, image-vs-text positioning, button styles, spacing rhythm, list/grid patterns, footer-CTA bands.
${themeintel.designGuidance()}
${themeintel.patternsContext()}

Return JSON: {"title":"...","slug":"...","metaDescription":"<155 chars>","content":"<full Gutenberg block markup matching the uploaded design>"}`,
    imageBase64, mimeType,
    maxTokens: 9000,
  });
  const info = db.prepare(
    "INSERT INTO pages(title, slug, kind, content, status) VALUES(?, ?, ?, ?, 'pending_review')"
  ).run(result.title || title, result.slug || slugify(result.title || title), kind, result.content);
  log.info('pages', `Replicated uploaded design as ${kind} page "${result.title || title}" (pending review)`);
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(info.lastInsertRowid);
}

// Pull an existing live page so the agent/user can propose a redesign.
export async function importLive(wpPageId) {
  const page = await wp.getPage(wpPageId);
  const info = db.prepare(
    "INSERT INTO pages(title, slug, kind, content, status, wp_page_id) VALUES(?, ?, 'standard', ?, 'imported', ?)"
  ).run(page.title.raw || page.title.rendered, page.slug, page.content.raw || page.content.rendered, page.id);
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(info.lastInsertRowid);
}

// Ask the AI to restyle/improve an existing page's layout (kept as a draft).
export async function redesign(pageId, instructions = '') {
  const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
  if (!p) throw new Error('Page not found');
  const result = await ai.json({
    system: 'You improve WordPress Gutenberg page layouts. Preserve the real information and links but improve structure, hierarchy, scannability and visual rhythm using core blocks.',
    prompt: `Current page "${p.title}" block markup:\n\n${p.content}\n\nImprovement instructions: ${instructions || 'Modernise the layout, improve headings, spacing and CTAs.'}\n${themeintel.designGuidance()}\n\nReturn JSON: {"content":"<improved Gutenberg block markup>"}`,
    maxTokens: 8000,
  });
  db.prepare("UPDATE pages SET content=?, status='pending_review', updated_at=datetime('now') WHERE id=?")
    .run(result.content, pageId);
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
}

export async function publish(pageId) {
  const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
  if (!p) throw new Error('Page not found');
  try {
    const status = cfg.get('publish_status') === 'draft' ? 'draft' : 'publish';
    // Use the theme's page template + per-page layout meta where configured.
    const meta = {};
    if (cfg.get('post_sidebar_layout')) meta['site-sidebar-layout'] = cfg.get('post_sidebar_layout');
    if (cfg.get('post_content_layout')) meta['site-content-layout'] = cfg.get('post_content_layout');
    const fields = { title: p.title, content: p.content, slug: p.slug, status, meta };
    if (cfg.get('page_template')) fields.template = cfg.get('page_template');
    let page;
    if (p.wp_page_id) page = await wp.updatePage(p.wp_page_id, fields);
    else page = await wp.createPage(fields);
    db.prepare("UPDATE pages SET status='published', wp_page_id=?, wp_url=?, published_at=COALESCE(published_at, datetime('now')), updated_at=datetime('now') WHERE id=?")
      .run(page.id, page.link, pageId);

    // If this is a cluster hub page, remember it on the cluster.
    log.info('pages', `Published page "${p.title}" → ${page.link}`);
    return page;
  } catch (e) {
    db.prepare("UPDATE pages SET error=? WHERE id=?").run(e.message, pageId);
    throw e;
  }
}

export function list() {
  return db.prepare('SELECT id, title, slug, kind, status, wp_url, error, updated_at FROM pages ORDER BY updated_at DESC').all();
}

export function get(id) {
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
}

export function update(id, fields) {
  const allowed = ['title', 'slug', 'content', 'status'];
  const sets = [], params = [];
  for (const k of allowed) if (k in fields) { sets.push(`${k}=?`); params.push(fields[k]); }
  if (!sets.length) return;
  sets.push("updated_at=datetime('now')");
  params.push(id);
  db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id=?`).run(...params);
}

export function remove(id) {
  db.prepare('DELETE FROM pages WHERE id = ?').run(id);
}

export default { design, replicate, importLive, redesign, publish, list, get, update, remove };
