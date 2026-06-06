// Site-wide internal linking automation. On publish it links a NEW post to the
// most relevant existing posts (forward links) AND adds one incoming link from a
// relevant existing post back to the new one (so nothing ships orphaned). It can
// also scan the whole site to report orphan pages (no incoming internal links).
import db from '../db.js';
import cfg from '../config.js';
import log from '../log.js';
import wp from '../clients/wp.js';

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the','a','an','of','to','for','and','or','in','on','with','how','what','is','are','your','you','best','guide','tips']);

function host() {
  try { return new URL(cfg.get('wp_base_url')).host; } catch { return ''; }
}
function tokens(s) {
  return [...new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];
}
function overlap(a, b) {
  const sb = new Set(b);
  return a.filter((t) => sb.has(t)).length;
}

// Deterministically insert a link to `toUrl` using `anchor` — inline if the
// anchor text already appears in the body, otherwise append a Related list item.
function insertLink(content, toUrl, anchor, toTitle) {
  if (content.includes(`href="${toUrl}"`)) return { content, mode: 'exists' };
  const esc = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(>[^<]*?)\\b(${esc})\\b`, 'i');
  if (re.test(content)) {
    return { content: content.replace(re, (m, pre, word) => `${pre}<a href="${toUrl}">${word}</a>`), mode: 'inline' };
  }
  const block = `\n\n<!-- wp:list -->\n<ul><li><a href="${toUrl}">${anchor || toTitle || toUrl}</a></li></ul>\n<!-- /wp:list -->`;
  return { content: content + block, mode: 'related' };
}

// Find existing published posts relevant to a keyword/title.
async function candidates(kw, title, excludeUrl) {
  const terms = tokens(`${kw} ${title}`).slice(0, 4).join(' ');
  if (!terms) return [];
  try {
    const r = await wp.browse('posts', { search: terms, per_page: 10, status: 'publish', context: 'view' });
    const wantTok = tokens(`${kw} ${title}`);
    return r.items
      .map((p) => ({ id: p.id, url: p.link, title: stripTags(p.title?.rendered || ''), score: overlap(wantTok, tokens(stripTags(p.title?.rendered || ''))) }))
      .filter((c) => c.url && c.url !== excludeUrl)
      .sort((a, b) => b.score - a.score);
  } catch (e) { log.warn('interlink', `candidate search failed: ${e.message}`); return []; }
}

// Auto-link a freshly published article (by id). Adds forward links from it and
// one reverse link to it from a relevant existing post.
export async function autoLinkArticle(articleId) {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
  if (!a || !a.wp_post_id || !a.content) return { linked: 0, skipped: 'no live post/content' };
  const kw = a.focus_keyword || a.keyword;
  const cands = await candidates(kw, a.title || '', a.wp_url);
  const max = cfg.getInt('interlink_max', 3);

  // 1) Forward links: from THIS post → top relevant existing posts.
  let content = a.content;
  let forward = 0;
  for (const c of cands.slice(0, max)) {
    const res = insertLink(content, c.url, c.title, c.title);
    if (res.mode !== 'exists') { content = res.content; forward++; }
  }
  if (forward) {
    db.prepare("UPDATE articles SET content=?, updated_at=datetime('now') WHERE id=?").run(content, articleId);
    try { await wp.updatePost(a.wp_post_id, { content }); } catch (e) { log.warn('interlink', `forward update failed: ${e.message}`); }
  }

  // 2) Reverse link: from the single most relevant existing post → THIS post,
  //    so the new article immediately has an incoming internal link.
  let reverse = 0;
  const top = cands[0];
  if (top && cfg.getBool('interlink_reverse')) {
    try {
      const full = await wp.listPosts({ include: top.id, context: 'edit', per_page: 1 });
      const body = Array.isArray(full) ? full[0] : (full.items ? full.items[0] : full);
      const existing = body?.content?.raw || body?.content?.rendered || '';
      if (existing && !existing.includes(`href="${a.wp_url}"`)) {
        const res = insertLink(existing, a.wp_url, a.title || kw, a.title);
        await wp.updatePost(top.id, { content: res.content });
        reverse = 1;
      }
    } catch (e) { log.warn('interlink', `reverse link failed: ${e.message}`); }
  }

  log.info('interlink', `#${articleId}: +${forward} forward, +${reverse} reverse links`);
  return { linked: forward + reverse, forward, reverse };
}

// Site-wide orphan scan: published posts with no incoming internal links.
export async function orphans({ limit = 200 } = {}) {
  const h = host();
  const incoming = new Map();   // url → count
  const all = [];
  let page = 1, pages = 1;
  do {
    const r = await wp.browse('posts', { page, per_page: 50, status: 'publish', context: 'view' });
    pages = r.totalPages;
    for (const p of r.items) {
      const url = p.link;
      all.push({ id: p.id, url, title: stripTags(p.title?.rendered || '') });
      const html = p.content?.rendered || '';
      for (const m of html.matchAll(/href="([^"]+)"/g)) {
        const href = m[1];
        if (h && href.includes(h)) incoming.set(href, (incoming.get(href) || 0) + 1);
      }
    }
    page++;
  } while (page <= pages && all.length < limit);

  const norm = (u) => u.replace(/\/+$/, '');
  const incNorm = new Map();
  for (const [u, c] of incoming) incNorm.set(norm(u), (incNorm.get(norm(u)) || 0) + c);
  const orphanList = all.filter((p) => !(incNorm.get(norm(p.url)) > 0));
  return { total: all.length, orphans: orphanList, orphanCount: orphanList.length };
}

export default { autoLinkArticle, orphans };
