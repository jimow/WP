// WordPress REST client. Authenticates with an Application Password (Basic auth).
// Covers posts, pages, categories, tags, and media so the agent can publish
// articles, create hub/landing pages, and update existing page layouts.
import cfg from '../config.js';
import log from '../log.js';

function creds() {
  const base = (cfg.get('wp_base_url') || '').trim().replace(/\/+$/, '');
  const user = (cfg.get('wp_username') || '').trim();
  // Application passwords are shown with spaces for readability; WordPress ignores
  // them. Strip surrounding whitespace and the internal spaces to avoid copy-paste
  // mismatches (a stray newline/space is the #1 cause of "You are not logged in").
  const pass = (cfg.get('wp_app_password') || '').trim().replace(/\s+/g, '');
  if (!base || !user || !pass) {
    throw new Error('WordPress is not configured (set wp_base_url, wp_username, wp_app_password in Settings).');
  }
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  return { base, auth };
}

// A realistic browser UA — some hosts soft-block obvious bot agents.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Detect a HOST/CDN bot-protection "checking your browser" challenge (Hostinger
// hCDN, Cloudflare, Sucuri…) so we can tell the user it's infrastructure — NOT
// their WordPress credentials. Returns a clear message, or null.
export function botChallengeMessage(res, text) {
  const server = (res.headers.get('server') || '').toLowerCase();
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const html = ct.includes('text/html');
  const challengeText = /just a moment|checking your browser|enable javascript|cf-browser-verification|attention required|sucuri|cloudflare/i.test(text || '');
  if ((html && challengeText) || ((res.status === 403 || res.status === 503) && /hcdn|cloudflare|sucuri/.test(server) && html)) {
    const who = /hcdn/.test(server) ? "Hostinger's CDN" : /cloudflare/.test(server) ? 'Cloudflare' : /sucuri/.test(server) ? 'Sucuri' : 'your host/CDN';
    return `Blocked by ${who} bot protection — NOT a WordPress or password problem. The host returned a "checking your browser" challenge (HTTP ${res.status}) on the REST API, so the request never reached WordPress. Fix on the host (not here): disable the CDN/bot-protection for this site, or allowlist the "/wp-json/" path (or this server's IP). On Hostinger: hPanel → Websites → CDN → turn it off, or ask Hostinger support to "allow REST API access at /wp-json/ through the CDN bot protection."`;
  }
  return null;
}

async function wpFetch(pathname, { method = 'GET', body, query } = {}) {
  const { base, auth } = creds();
  let url = `${base}/wp-json/wp/v2${pathname}`;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'User-Agent': BROWSER_UA,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const challenge = botChallengeMessage(res, text);
    if (challenge) throw new Error(challenge);
    const msg = data && data.message ? data.message : `${res.status} ${res.statusText}`;
    if (res.status === 401) {
      throw new Error(`WordPress rejected the credentials (401): "${msg}". Check the Username is the exact login name and the Application Password belongs to that same user (generate a fresh one if unsure).`);
    }
    throw new Error(`WP ${method} ${pathname} failed: ${msg}`);
  }
  return data;
}

export const wp = {
  // Validate connection + identity. Returns the current user.
  async me() {
    return wpFetch('/users/me', { query: { context: 'edit' } });
  },

  async listCategories() {
    return wpFetch('/categories', { query: { per_page: 100 } });
  },

  // Registered post statuses (publish, draft, pending, private, future, …) —
  // discovered live from the connection, not hard-coded.
  async listStatuses() {
    const d = await wpFetch('/statuses');
    return Object.values(d || {}).map((s) => ({ slug: s.slug, name: s.name }));
  },

  // Page/post templates the active theme registers (block themes expose these).
  async listTemplates() {
    try {
      const d = await wpFetch('/templates', { query: { per_page: 100 } });
      return Array.isArray(d) ? d.map((t) => ({ slug: t.slug, title: t.title?.rendered || t.title?.raw || t.slug })) : [];
    } catch { return []; }
  },

  // Discover the post meta keys the active theme + plugins expose over REST via
  // an OPTIONS request on /posts (the JSON schema lists registered meta). This is
  // how we surface a theme's appearance controls WITHOUT hard-coding any theme.
  async discoverMetaKeys() {
    try {
      const d = await wpFetch('/posts', { method: 'OPTIONS' });
      const props = d?.schema?.properties?.meta?.properties || {};
      return Object.entries(props).map(([key, v]) => ({ key, type: v.type || 'string', enum: v.enum || null }));
    } catch { return []; }
  },

  async listTags() {
    return wpFetch('/tags', { query: { per_page: 100 } });
  },

  async ensureCategory(name) {
    if (!name) return null;
    const found = await wpFetch('/categories', { query: { search: name } });
    const hit = found.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const created = await wpFetch('/categories', { method: 'POST', body: { name } });
    return created.id;
  },

  async ensureTag(name) {
    if (!name) return null;
    const found = await wpFetch('/tags', { query: { search: name } });
    const hit = found.find((t) => t.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const created = await wpFetch('/tags', { method: 'POST', body: { name } });
    return created.id;
  },

  // Create a post. status: 'draft' | 'publish' | 'future' | 'pending'
  async createPost({ title, content, excerpt, slug, status = 'draft', categories = [], tags = [], meta = {}, date }) {
    const body = { title, content, excerpt, slug, status, meta };
    if (categories.length) body.categories = categories;
    if (tags.length) body.tags = tags;
    if (date) body.date = date;
    const post = await wpFetch('/posts', { method: 'POST', body });
    log.info('wp', `created post #${post.id} (${status}) "${title}"`);
    return post;
  },

  async updatePost(id, fields) {
    return wpFetch(`/posts/${id}`, { method: 'POST', body: fields });
  },

  async listPosts(params = {}) {
    return wpFetch('/posts', { query: { per_page: 20, context: 'edit', ...params } });
  },

  // Pages — used for hub pages, landing pages, and layout edits.
  async createPage({ title, content, slug, status = 'draft', parent, template, menu_order, meta }) {
    const body = { title, content, slug, status };
    if (parent) body.parent = parent;
    if (template) body.template = template;
    if (menu_order != null) body.menu_order = menu_order;
    if (meta && Object.keys(meta).length) body.meta = meta;
    const page = await wpFetch('/pages', { method: 'POST', body });
    log.info('wp', `created page #${page.id} (${status}) "${title}"`);
    return page;
  },

  async updatePage(id, fields) {
    return wpFetch(`/pages/${id}`, { method: 'POST', body: fields });
  },

  async getPage(id) {
    return wpFetch(`/pages/${id}`, { query: { context: 'edit' } });
  },

  // Fetch ONE post or page with full content/meta for a detail view. Falls back
  // to context=view if the app-password user can't read edit context.
  async getItem(type, id) {
    const path = `/${type === 'pages' ? 'pages' : 'posts'}/${id}`;
    try { return await wpFetch(path, { query: { context: 'edit' } }); }
    catch { return wpFetch(path, { query: { context: 'view' } }); }
  },

  async listPages(params = {}) {
    return wpFetch('/pages', { query: { per_page: 50, context: 'edit', ...params } });
  },

  // --- Plugins (WP 5.5+ REST). Needs an admin app-password + file mods allowed.
  async listPlugins() {
    return wpFetch('/plugins', { query: { per_page: 100 } });
  },

  // plugin is the file id from the list, e.g. "akismet/akismet".
  async togglePlugin(plugin, active) {
    return wpFetch(`/plugins/${plugin}`, { method: 'POST', body: { status: active ? 'active' : 'inactive' } });
  },

  // Install (and activate) a plugin from the wordpress.org directory by slug.
  async installPlugin(slug, activate = true) {
    const created = await wpFetch('/plugins', { method: 'POST', body: { slug } });
    if (activate && created?.plugin) {
      try { return await wp.togglePlugin(created.plugin, true); } catch { /* installed but not activated */ }
    }
    log.info('wp', `installed plugin "${slug}"`);
    return created;
  },

  // --- Themes (list + show which is active). Switching the active theme is not
  // exposed by core REST, so we surface status read-only.
  async listThemes() {
    return wpFetch('/themes', { query: { per_page: 100 } });
  },

  // --- Media library + featured images --------------------------------------
  async listMedia(params = {}) {
    return wpFetch('/media', { query: { per_page: 20, ...params } });
  },

  // Upload raw bytes to the media library; optionally set alt text + title.
  async uploadMedia(bytes, { filename = 'image.jpg', contentType = 'image/jpeg', alt, title } = {}) {
    const { base, auth } = creds();
    const res = await fetch(`${base}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: bytes,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WP media upload failed: ${data.message || res.status}`);
    if (alt || title) {
      try { await wpFetch(`/media/${data.id}`, { method: 'POST', body: { alt_text: alt || '', title: title || '' } }); } catch { /* non-fatal */ }
    }
    log.info('wp', `uploaded media #${data.id} (${filename})`);
    return data; // { id, source_url, ... }
  },

  // Fetch an image by URL and add it to the media library.
  async uploadMediaFromUrl(url, { filename, alt, title } = {}) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Could not fetch image (${r.status})`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    const name = filename || (url.split('/').pop() || 'image').split('?')[0] || 'image.jpg';
    return wp.uploadMedia(bytes, { filename: name, contentType, alt, title });
  },

  async setFeaturedImage(postId, mediaId) {
    return wpFetch(`/posts/${postId}`, { method: 'POST', body: { featured_media: mediaId } });
  },

  // --- Site settings (title, tagline, etc.) — needs manage_options ----------
  async getSiteSettings() {
    return wpFetch('/settings');
  },
  async updateSiteSettings(fields) {
    return wpFetch('/settings', { method: 'POST', body: fields });
  },

  // --- Comments moderation --------------------------------------------------
  async listComments(params = {}) {
    return wpFetch('/comments', { query: { per_page: 50, context: 'edit', ...params } });
  },
  // status: approved | hold | spam | trash
  async moderateComment(id, status) {
    return wpFetch(`/comments/${id}`, { method: 'POST', body: { status } });
  },

  // --- Users (read) ---------------------------------------------------------
  async listUsers() {
    return wpFetch('/users', { query: { per_page: 50, context: 'edit' } });
  },

  // --- Trash (soft-delete; pass force=true to permanently delete) -----------
  async trashPost(id, force = false) {
    return wpFetch(`/posts/${id}`, { method: 'DELETE', query: force ? { force: true } : undefined });
  },
  async trashPage(id, force = false) {
    return wpFetch(`/pages/${id}`, { method: 'DELETE', query: force ? { force: true } : undefined });
  },

  // --- Paginated browsing of live content (returns items + page meta) -------
  // status may be a comma-string or array; sent as repeated status[] params so
  // it works across WP versions (older cores don't accept status=any).
  async browse(type, { page = 1, per_page = 10, status, search, orderby = 'date', order = 'desc', context = 'edit' } = {}) {
    const { base, auth } = creds();
    const q = new URLSearchParams({ page, per_page, context, orderby, order });
    if (search) q.set('search', search);
    if (status) {
      for (const s of (Array.isArray(status) ? status : String(status).split(','))) {
        if (s) q.append('status[]', s);
      }
    }
    const res = await fetch(`${base}/wp-json/wp/v2/${type}?${q}`, { headers: { Authorization: `Basic ${auth}`, 'User-Agent': BROWSER_UA } });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : []; } catch { data = []; }
    if (!res.ok) {
      const challenge = botChallengeMessage(res, text);
      throw new Error(challenge || `WP ${type} list failed: ${data?.message || res.status}`);
    }
    return {
      items: data,
      total: +(res.headers.get('X-WP-Total') || data.length || 0),
      totalPages: +(res.headers.get('X-WP-TotalPages') || 1),
      page: +page,
    };
  },

  async setPostStatus(id, status) { return wpFetch(`/posts/${id}`, { method: 'POST', body: { status } }); },
  async setPageStatus(id, status) { return wpFetch(`/pages/${id}`, { method: 'POST', body: { status } }); },
  async deleteMedia(id, force = true) { return wpFetch(`/media/${id}`, { method: 'DELETE', query: force ? { force: true } : undefined }); },

  // Read Rank Math's own data for a post (the REAL plugin score + focus keyword),
  // if Rank Math exposes its meta over REST. Returns nulls if not available.
  async getRankMath(id, type = 'posts') {
    const p = await wpFetch(`/${type}/${id}`, { query: { context: 'edit' } });
    const meta = p.meta || {};
    const num = (v) => (v === '' || v == null ? null : Number(v));
    return {
      id: p.id,
      title: p.title?.rendered || p.title?.raw,
      score: num(meta.rank_math_seo_score),
      focusKeyword: meta.rank_math_focus_keyword || null,
      pillar: meta.rank_math_pillar_content || null,
      hasMeta: 'rank_math_focus_keyword' in meta || 'rank_math_seo_score' in meta,
    };
  },

  // Bulk Rank Math scores via the companion "SEO Bridge" plugin (one request).
  // Throws a recognizable error if the plugin isn't installed so the UI can prompt.
  async rankMathScores(ids = []) {
    const { base, auth } = creds();
    const q = ids.length ? `?ids=${ids.join(',')}` : '';
    const res = await fetch(`${base}/wp-json/wp-autopilot/v1/scores${q}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.status === 404) { const e = new Error('SEO Bridge plugin not installed'); e.code = 'NO_BRIDGE'; throw e; }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `scores failed (${res.status})`);
    return data;
  },

  // Resolve a public URL to its WP post or page (matches by slug).
  async findByUrl(url) {
    let slug = '';
    try { slug = new URL(url).pathname.replace(/\/+$/, '').split('/').pop(); } catch { slug = ''; }
    if (!slug) throw new Error(`Could not derive a slug from ${url}`);
    const posts = await wpFetch('/posts', { query: { slug, context: 'edit', per_page: 1 } });
    if (posts.length) return { kind: 'post', ...posts[0] };
    const pages = await wpFetch('/pages', { query: { slug, context: 'edit', per_page: 1 } });
    if (pages.length) return { kind: 'page', ...pages[0] };
    throw new Error(`No WordPress post/page found for "${slug}"`);
  },

  // Total item count for a type (reads the X-WP-Total response header).
  async total(type) {
    const { base, auth } = creds();
    const res = await fetch(`${base}/wp-json/wp/v2/${type}?per_page=1`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) throw new Error(`count ${type} failed: ${res.status}`);
    return parseInt(res.headers.get('X-WP-Total') || '0', 10);
  },
};

export default wp;
