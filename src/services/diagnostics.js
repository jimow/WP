// Comprehensive WordPress capability probe. Answers "what can the agent actually
// do on this site?" without creating throwaway content — it reads the connected
// user's real capabilities (from /users/me?context=edit) plus checks that each
// REST endpoint the agent relies on is reachable, and reports site facts + counts.
import wp from '../clients/wp.js';
import cfg from '../config.js';

// Capability key -> what it unlocks for the agent.
const CAPS = [
  ['edit_posts', 'Create & edit articles'],
  ['publish_posts', 'Publish articles live'],
  ['delete_posts', 'Trash / delete articles'],
  ['edit_pages', 'Create & edit pages'],
  ['publish_pages', 'Publish pages live'],
  ['edit_others_posts', 'Edit content by other authors'],
  ['manage_categories', 'Manage categories & tags'],
  ['upload_files', 'Upload media & featured images'],
  ['moderate_comments', 'Moderate comments'],
  ['manage_options', 'Read / change site settings'],
  ['activate_plugins', 'Install & manage plugins'],
  ['edit_theme_options', 'Edit theme options & menus'],
  ['list_users', 'List users'],
];

export async function run() {
  if (!(cfg.get('wp_base_url') && cfg.get('wp_app_password'))) {
    throw new Error('WordPress is not configured yet. Add your site URL, username and Application Password in Settings.');
  }

  const out = { identity: null, capabilities: [], endpoints: [], counts: {}, site: null, seo: null, warnings: [] };

  // 1) Identity + capabilities (authoritative, non-destructive).
  const me = await wp.me();
  out.identity = { name: me.name, username: me.slug, roles: me.roles || [] };
  const caps = me.capabilities || {};
  out.capabilities = CAPS.map(([key, label]) => ({ key, label, has: !!caps[key] }));
  if (!caps.edit_posts) out.warnings.push('This user cannot edit posts — give it an Editor or Administrator role to publish articles.');

  // 2) Endpoint reachability (+ collect some payloads), each independent.
  const probe = async (label, fn) => {
    try { const v = await fn(); out.endpoints.push({ label, ok: true }); return v; }
    catch (e) { out.endpoints.push({ label, ok: false, error: e.message }); return null; }
  };
  await probe('Read posts', () => wp.listPosts({ per_page: 1 }));
  await probe('Read pages', () => wp.listPages({ per_page: 1 }));
  await probe('Media library', () => wp.listMedia({ per_page: 1 }));
  await probe('Categories & tags', () => wp.listCategories());
  await probe('Comments', () => wp.listComments({ per_page: 1 }));
  const settings = await probe('Site settings', () => wp.getSiteSettings());
  const plugins = await probe('Plugins API', () => wp.listPlugins());
  await probe('Themes API', () => wp.listThemes());

  // 3) Site facts.
  if (settings) {
    out.site = {
      title: settings.title,
      tagline: settings.description,
      url: settings.url,
      language: settings.language,
      timezone: settings.timezone_string,
      dateFormat: settings.date_format,
    };
  }

  // 4) Counts (best-effort; uses X-WP-Total header).
  for (const type of ['posts', 'pages', 'media', 'categories', 'tags', 'comments', 'users']) {
    try { out.counts[type] = await wp.total(type); } catch { /* skip */ }
  }

  // 5) SEO plugin detection (Rank Math / Yoast).
  if (plugins) {
    const rank = plugins.find((p) => /rank ?math/i.test(p.name || '') || /rank-math|seo-by-rank-math/i.test(p.plugin || ''));
    const yoast = plugins.find((p) => /yoast|wordpress seo/i.test(p.name || ''));
    out.seo = { rankMath: rank ? rank.status : null, yoast: yoast ? yoast.status : null };
    if (!rank && !yoast) out.warnings.push('No SEO plugin detected. Install Rank Math (Themes & Plugins) so the focus keyword & meta fields are used.');
    else if (rank && rank.status !== 'active') out.warnings.push('Rank Math is installed but not active.');
  }

  const okCaps = out.capabilities.filter((c) => c.has).length;
  out.summary = {
    capabilities: `${okCaps}/${out.capabilities.length}`,
    endpointsOk: out.endpoints.filter((e) => e.ok).length,
    endpointsTotal: out.endpoints.length,
    canPublish: !!caps.edit_posts && !!caps.publish_posts,
  };
  return out;
}

export default { run };
