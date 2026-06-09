// All dashboard/API endpoints. Thin handlers over the service layer.
import express from 'express';
import db from '../db.js';
import cfg from '../config.js';
import { SCHEMA } from '../settings-schema.js';
import log from '../log.js';
import wp from '../clients/wp.js';
import ahrefs from '../clients/ahrefs.js';
import ai from '../clients/ai.js';
import gsc from '../clients/gsc.js';
import keywords from '../services/keywords.js';
import clusters from '../services/clusters.js';
import articles from '../services/articles.js';
import pages from '../services/pages.js';
import pipeline from '../services/pipeline.js';
import insights from '../services/insights.js';
import stats from '../services/stats.js';
import diagnostics from '../services/diagnostics.js';
import optimize from '../services/optimize.js';
import strategy from '../services/strategy.js';
import postintel from '../services/postintel.js';
import kwindex from '../services/kwindex.js';
import themeintel from '../services/themeintel.js';
import replenish from '../services/replenish.js';
import calendar from '../services/calendar.js';
import ranktrack from '../services/ranktrack.js';
import indexmon from '../services/indexmon.js';
import indexview from '../services/indexview.js';
import interlink from '../services/interlink.js';
import distribute from '../services/distribute.js';
import supabase from '../clients/supabase.js';
import resend from '../clients/resend.js';
import backup from '../services/backup.js';
import auth from '../auth.js';
import tenancy from '../tenancy.js';

const redirectUri = (req) => `${req.protocol}://${req.get('host')}/api/gsc/callback`;
const SESSION_MAXAGE = 60 * 60 * 24 * 30;
function setSession(res, token) { res.setHeader('Set-Cookie', `wpap_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAXAGE}; SameSite=Lax`); }
function clearSession(res) { res.setHeader('Set-Cookie', 'wpap_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'); }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const router = express.Router();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  log.error('api', `${req.method} ${req.path}: ${e.message}`);
  res.status(400).json({ error: e.message });
});

// ---- Auth -----------------------------------------------------------------
router.get('/auth/me', wrap((req, res) => res.json({ user: auth.publicUser(req.user), authActive: auth.authActive(), userCount: auth.userCount() })));
router.post('/auth/register', wrap((req, res) => {
  const u = auth.register(req.body || {});
  setSession(res, auth.makeSession(u));
  res.json({ user: auth.publicUser(u) });
}));
router.post('/auth/login', wrap((req, res) => {
  const u = auth.login(req.body || {});
  setSession(res, auth.makeSession(u));
  res.json({ user: auth.publicUser(u) });
}));
router.post('/auth/logout', wrap((req, res) => { clearSession(res); res.json({ ok: true }); }));
router.post('/auth/forgot', wrap(async (req, res) => {
  const r = auth.startReset((req.body || {}).email);
  let emailed = false;
  if (r) {
    // Point at the login page's reset form (the gate serves marketing at "/").
    const link = `${req.protocol}://${req.get('host')}/login.html?reset=${r.token}`;
    log.info('auth', `Password reset link for ${r.email}: ${link}`);
    if (resend.configured()) {
      try { await resend.sendPasswordReset(r.email, link, { name: r.name }); emailed = true; }
      catch (e) { log.warn('auth', `Resend reset email failed: ${e.message}`); }
    }
    if (!emailed) { try { await distribute.notify('password-reset', `Password reset requested for ${r.email}: ${link}`, { level: 'warn' }); } catch { /* ignore */ } }
  }
  // Never reveal whether the email exists; `emailDelivery` tells the UI what to say.
  res.json({ ok: true, emailDelivery: resend.configured() ? 'email' : 'manual' });
}));
// Send a Resend test email (super-admin only) to confirm the integration.
router.post('/resend/test', wrap(async (req, res) => {
  const to = (req.body && req.body.to) || (req.user && req.user.email);
  if (!to) throw new Error('No recipient — provide an email or sign in.');
  const out = await resend.test(to);
  res.json({ ok: true, id: out.id, to });
}));
router.post('/auth/reset', wrap((req, res) => {
  const u = auth.resetPassword(req.body || {});
  setSession(res, auth.makeSession(u));
  res.json({ user: auth.publicUser(u) });
}));
router.get('/auth/users', wrap((req, res) => res.json(req.user && req.user.role === 'super_admin' ? auth.listUsers() : [])));

// ---- Status / dashboard ---------------------------------------------------
router.get('/status', wrap(async (req, res) => {
  const counts = (table, col = 'status') =>
    db.prepare(`SELECT ${col} k, COUNT(*) n FROM ${table} GROUP BY ${col}`).all()
      .reduce((a, r) => ((a[r.k] = r.n), a), {});
  const lastRun = db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get();
  res.json({
    automation_enabled: cfg.getBool('automation_enabled'),
    autonomy: cfg.get('autonomy'),
    tick_cron: cfg.get('tick_cron'),
    articles_per_day: cfg.getInt('articles_per_day', 3),
    connections: {
      wordpress: !!(cfg.get('wp_base_url') && cfg.get('wp_app_password')),
      ahrefs: ahrefs.configured(),
      ai: ai.configured(),
      gsc: gsc.configured(),
    },
    keywords: counts('keywords'),
    articles: counts('articles'),
    pages: counts('pages'),
    clusters: db.prepare('SELECT COUNT(*) n FROM clusters').get().n,
    publishedToday: db.prepare("SELECT COUNT(*) n FROM articles WHERE status='published' AND date(updated_at)=date('now')").get().n,
    lastRun: lastRun ? { ...lastRun, summary: lastRun.summary ? JSON.parse(lastRun.summary) : null } : null,
  });
}));

// ---- Connection tests -----------------------------------------------------
router.post('/test/wordpress', wrap(async (req, res) => {
  const me = await wp.me();
  res.json({ ok: true, user: me.name, roles: me.roles });
}));
router.post('/test/ahrefs', wrap(async (req, res) => {
  const info = await ahrefs.ping();
  res.json({ ok: true, info });
}));
// ---- Ahrefs: keywords, competitors, backlinks, domain intelligence --------
function ahrefsTarget(req) {
  const t = (req.query.target || '').trim();
  if (t) return t;
  try { return new URL(cfg.get('wp_base_url')).host; } catch { return cfg.get('wp_base_url') || ''; }
}
router.get('/ahrefs/status', wrap(async (req, res) => {
  if (!ahrefs.configured()) return res.json({ configured: false });
  let limits = null;
  try { limits = await ahrefs.ping(); } catch { /* ignore */ }
  res.json({ configured: true, limits, defaultTarget: ahrefsTarget(req) });
}));
router.get('/ahrefs/keywords', wrap(async (req, res) => res.json(await ahrefs.keywordIdeas((req.query.seed || '').trim(), req.query.country || cfg.get('target_country') || 'us', +req.query.limit || 50))));
router.get('/ahrefs/competitors', wrap(async (req, res) => res.json(await ahrefs.serpOverview((req.query.keyword || '').trim(), req.query.country || cfg.get('target_country') || 'us', +req.query.limit || 10))));
router.get('/ahrefs/domain', wrap(async (req, res) => res.json(await ahrefs.domainOverview(ahrefsTarget(req), req.query.country || cfg.get('target_country') || 'us'))));
router.get('/ahrefs/backlinks', wrap(async (req, res) => res.json(await ahrefs.backlinks(ahrefsTarget(req), +req.query.limit || 30))));
router.get('/ahrefs/refdomains', wrap(async (req, res) => res.json(await ahrefs.refDomains(ahrefsTarget(req), +req.query.limit || 30))));
router.get('/ahrefs/organic', wrap(async (req, res) => res.json(await ahrefs.organicKeywords(ahrefsTarget(req), req.query.country || cfg.get('target_country') || 'us', +req.query.limit || 40))));
router.get('/ahrefs/toppages', wrap(async (req, res) => res.json(await ahrefs.topPages(ahrefsTarget(req), req.query.country || cfg.get('target_country') || 'us', +req.query.limit || 25))));

router.post('/test/ai', wrap(async (req, res) => {
  // Higher budget so reasoning models (gpt-5.x, o-series) leave room for output.
  const out = await ai.complete({ prompt: 'Reply with the single word: ready', maxTokens: 1000 });
  res.json({ ok: true, reply: (out || '').trim() || '(connected; model returned no text for this tiny prompt)' });
}));

// ---- Settings -------------------------------------------------------------
// The dashboard renders its entire settings UI from this schema (no hard-coded
// form) so every owner-configurable behavior lives in one declarative place.
router.get('/settings/schema', wrap((req, res) => {
  // Annotate each field as shared (all tenants) or per-tenant, AND where its
  // effective value comes from (dashboard / .env / default) so the UI can show it.
  const annotated = SCHEMA.map((g) => ({ ...g, fields: g.fields.map((f) => ({ ...f, scope: tenancy.isGlobalKey(f.key) ? 'shared' : 'tenant', source: cfg.sourceOf(f.key) })) }));
  res.json(annotated);
}));
router.get('/settings', wrap((req, res) => res.json(cfg.publicAll())));
router.post('/settings', wrap((req, res) => {
  const body = req.body || {};
  for (const [k, v] of Object.entries(body)) {
    // Never overwrite a stored secret with a masked placeholder. Robust against
    // any bullet/asterisk masking (defense in depth — the UI also won't send it).
    if (cfg.isSecret(k) && typeof v === 'string' && /[••*]/.test(v)) continue;
    cfg.set(k, v);
  }
  log.info('settings', `updated ${Object.keys(body).length} field(s)`);
  res.json(cfg.publicAll());
}));

// ---- Keyword index (duplicate / cannibalisation guard) --------------------
router.get('/kwindex', wrap((req, res) => res.json(kwindex.status())));
router.post('/kwindex/build', wrap(async (req, res) => res.json(await kwindex.build())));
router.post('/kwindex/check', wrap(async (req, res) => res.json(await kwindex.filter(req.body.keywords || []))));

// ---- Keywords -------------------------------------------------------------
router.get('/keywords', wrap((req, res) => res.json(keywords.list({ status: req.query.status }))));
router.post('/keywords/research', wrap(async (req, res) => {
  const n = await keywords.researchSeed(req.body.seed, { limit: req.body.limit || 50 });
  res.json({ ok: true, imported: n });
}));
router.post('/keywords/manual', wrap((req, res) => {
  keywords.addManual(req.body.keyword, req.body);
  res.json({ ok: true });
}));
router.post('/keywords/:id/status', wrap((req, res) => {
  keywords.setStatus(req.params.id, req.body.status); res.json({ ok: true });
}));
router.delete('/keywords/:id', wrap((req, res) => { keywords.remove(req.params.id); res.json({ ok: true }); }));

// ---- Clusters (hub & spoke) ----------------------------------------------
router.get('/clusters', wrap((req, res) => res.json(clusters.list())));
router.get('/clusters/:id', wrap((req, res) => res.json(clusters.get(req.params.id))));
router.post('/clusters/plan', wrap(async (req, res) => {
  const { keywords, maxClusters, spokesPerCluster, intent, brief } = req.body || {};
  const result = await clusters.planFromKeywords({ keywords, maxClusters, spokesPerCluster, intent, brief });
  res.json({ ok: true, ...result });
}));
// Propose a structure (no save) so the wizard can show it for review/edit.
router.post('/clusters/propose', wrap(async (req, res) => res.json({ clusters: await clusters.propose(req.body || {}) })));
// Create from a (possibly edited) plan → { created:[...], skipped:[...] }.
router.post('/clusters/create', wrap((req, res) => res.json(clusters.createFromPlan(req.body.clusters || [], { allowDuplicates: req.body.allowDuplicates }))));
router.delete('/clusters/:id', wrap((req, res) => { clusters.remove(req.params.id); res.json({ ok: true }); }));
router.get('/clusters/:id/suggest-spokes', wrap(async (req, res) => res.json({ spokes: await clusters.suggestSpokes(req.params.id, +req.query.count || 6) })));

// ---- Articles -------------------------------------------------------------
router.get('/articles', wrap((req, res) => res.json(articles.list({ status: req.query.status, clusterId: req.query.cluster }))));
router.get('/articles/:id', wrap((req, res) => res.json(articles.get(req.params.id))));
router.get('/articles/:id/seo', wrap((req, res) => res.json(articles.seoReport(req.params.id))));
router.post('/articles/:id/analyze', wrap(async (req, res) => res.json(await postintel.analyze({ articleId: req.params.id }))));
// Latest PERSISTED analysis (so the panel survives navigation) + apply edits.
router.get('/articles/:id/analysis', wrap((req, res) => res.json(postintel.getLatest({ articleId: req.params.id }))));
router.post('/articles/:id/apply-improvements', wrap(async (req, res) => res.json(await postintel.applyImprovements(req.params.id))));
router.post('/articles/:id/insert-links', wrap(async (req, res) => res.json(await postintel.insertInternalLinks({ articleId: req.params.id }, req.body.links || []))));
// Unified intelligence — accepts {articleId} or {url} (live post).
router.post('/intel/analyze', wrap(async (req, res) => res.json(await postintel.analyze(req.body || {}))));
router.get('/intel/analysis', wrap((req, res) => res.json(postintel.getLatest({ url: req.query.url }))));
router.post('/intel/insert-links', wrap(async (req, res) => res.json(await postintel.insertInternalLinks(req.body || {}, req.body.links || []))));
router.post('/articles/:id/convert-to-hub', wrap((req, res) => res.json(clusters.convertArticleToHub(req.params.id, req.body.spokes || []))));
router.post('/articles/idea', wrap((req, res) => res.json({ id: articles.addIdea(req.body.keyword, req.body.role, req.body.clusterId) })));
router.post('/articles/analyze-keywords', wrap((req, res) => res.json(articles.analyzeKeywords(req.body.keywords || []))));
router.post('/articles/ideas', wrap((req, res) => res.json(articles.addIdeasBulk(req.body.keywords || []))));
router.post('/articles/:id/generate', wrap(async (req, res) => res.json(await articles.generate(req.params.id, req.body || {}))));
router.post('/articles/:id/approve', wrap(async (req, res) => {
  articles.setStatus(req.params.id, 'approved');
  if (req.body.publishNow) await articles.publish(req.params.id, { confirm: !!req.body.confirm });
  res.json({ ok: true });
}));
router.post('/articles/:id/publish', wrap(async (req, res) => res.json(await articles.publish(req.params.id, { confirm: !!req.body?.confirm, scheduledDate: req.body?.scheduledDate, options: req.body?.options }))));
router.post('/articles/:id/confirm-kw', wrap((req, res) => res.json(articles.confirmKeyword(req.params.id))));
router.post('/articles/:id/duplicate', wrap((req, res) => res.json(articles.duplicate(req.params.id))));
router.put('/articles/:id', wrap((req, res) => { articles.update(req.params.id, req.body); res.json({ ok: true }); }));
router.post('/articles/:id/status', wrap((req, res) => { articles.setStatus(req.params.id, req.body.status); res.json({ ok: true }); }));
router.delete('/articles/:id', wrap((req, res) => { articles.remove(req.params.id); res.json({ ok: true }); }));

// ---- Pages / layout -------------------------------------------------------
router.get('/pages', wrap((req, res) => res.json(pages.list())));
router.get('/pages/:id', wrap((req, res) => res.json(pages.get(req.params.id))));
router.post('/pages/design', wrap(async (req, res) => res.json(await pages.design(req.body))));
router.post('/pages/replicate', wrap(async (req, res) => res.json(await pages.replicate(req.body))));
router.post('/pages/import', wrap(async (req, res) => res.json(await pages.importLive(req.body.wpPageId))));
router.post('/pages/:id/redesign', wrap(async (req, res) => res.json(await pages.redesign(req.params.id, req.body.instructions))));
router.post('/pages/:id/publish', wrap(async (req, res) => res.json(await pages.publish(req.params.id))));
router.put('/pages/:id', wrap((req, res) => { pages.update(req.params.id, req.body); res.json({ ok: true }); }));
router.delete('/pages/:id', wrap((req, res) => { pages.remove(req.params.id); res.json({ ok: true }); }));

// Convenience: list live WP pages so the user can pick one to import/redesign.
router.get('/wp/pages', wrap(async (req, res) => {
  const list = await wp.listPages({ per_page: 50 });
  res.json(list.map((p) => ({ id: p.id, title: p.title.rendered, slug: p.slug, link: p.link })));
}));

// Appearance/publish options discovered LIVE from the connected site + active
// theme — nothing hard-coded. Layout controls are only the meta keys the theme
// actually registers (matched to friendly value sets by naming convention).
const META_HINTS = [
  { match: /sidebar-layout/i, label: 'Sidebar', options: [['', 'Theme default'], ['no-sidebar', 'No sidebar'], ['left-sidebar', 'Left sidebar'], ['right-sidebar', 'Right sidebar']] },
  { match: /content-layout/i, label: 'Content width', options: [['', 'Theme default'], ['plain-container', 'Full width'], ['content-boxed-container', 'Boxed'], ['page-builder', 'Stretched (no container)']] },
  { match: /title-bar|post-title/i, label: 'Page title', options: [['', 'Theme default'], ['enabled', 'Show'], ['disabled', 'Hide']] },
  { match: /featured-img|featured[-_]image/i, label: 'Featured image', options: [['', 'Theme default'], ['enabled', 'Show'], ['disabled', 'Hide']] },
  { match: /transparent-header/i, label: 'Transparent header', options: [['', 'Theme default'], ['enabled', 'On'], ['disabled', 'Off']] },
];
router.get('/wp/publish-options', wrap(async (req, res) => {
  const [statuses, categories, templates, metaKeys] = await Promise.all([
    wp.listStatuses().catch(() => []),
    wp.listCategories().then((c) => c.map((x) => ({ id: x.id, name: x.name }))).catch(() => []),
    wp.listTemplates().catch(() => []),
    wp.discoverMetaKeys().catch(() => []),
  ]);
  // Keep only the registered meta keys that map to a known appearance control.
  const layoutMeta = [];
  for (const m of metaKeys) {
    const hint = META_HINTS.find((h) => h.match.test(m.key));
    if (hint) layoutMeta.push({ key: m.key, label: hint.label, options: m.enum ? m.enum.map((v) => [v, v]) : hint.options });
  }
  res.json({
    statuses: statuses.length ? statuses : [{ slug: 'publish', name: 'Published' }, { slug: 'draft', name: 'Draft' }, { slug: 'future', name: 'Scheduled' }],
    categories, templates, layoutMeta,
    theme: themeintel.profile(),
    defaults: {
      publish_status: cfg.get('publish_status'),
      default_category: cfg.get('default_category'),
      auto_featured_image: cfg.getBool('auto_featured_image'),
    },
  });
}));

// ---- Automation control ---------------------------------------------------
router.post('/automation/toggle', wrap((req, res) => {
  cfg.set('automation_enabled', req.body.enabled ? 'true' : 'false');
  res.json({ enabled: req.body.enabled });
}));
router.post('/automation/run-now', wrap(async (req, res) => res.json(await pipeline.tick({ manual: true }))));

// ---- Autopilot: self-replenish + editorial calendar -----------------------
router.get('/autopilot/queue', wrap((req, res) => res.json({ ideas: replenish.ideaQueueDepth(), minIdeas: cfg.getInt('min_idea_queue', 5), autoReplenish: cfg.getBool('auto_replenish') })));
router.post('/autopilot/replenish', wrap(async (req, res) => res.json(await replenish.run({ force: !!req.body?.force }))));
router.get('/autopilot/calendar', wrap((req, res) => res.json({ cadence: cfg.get('publish_cadence'), times: cfg.get('publish_times'), upcoming: calendar.upcoming(), nextSlots: calendar.nextSlots(5) })));

// ---- Rank tracking --------------------------------------------------------
router.get('/ranktrack/summary', wrap((req, res) => res.json(ranktrack.summary())));
router.get('/ranktrack/trends', wrap((req, res) => res.json(ranktrack.trends({ lookback: +req.query.days || 30 }))));
router.post('/ranktrack/snapshot', wrap(async (req, res) => res.json(await ranktrack.snapshot({ force: !!req.body?.force }))));

// ---- Index monitoring -----------------------------------------------------
// Aggregated index + performance view of the site's existing pages — LIVE GSC
// performance for the chosen range + real index verdicts (two tabs).
router.get('/index/overview', wrap(async (req, res) => res.json(await indexview.overview({ range: req.query.range }))));
// Live URL Inspection of several URLs at once (the "check now" action).
router.post('/index/check', wrap(async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 20) : [];
  const results = [];
  for (const url of urls) {
    try { results.push({ url, ...(await indexmon.check(url)) }); }
    catch (e) { results.push({ url, error: e.message }); }
  }
  res.json({ checked: results.filter((r) => !r.error).length, results });
}));
router.get('/indexmon/summary', wrap((req, res) => res.json(indexmon.summary())));
router.get('/indexmon/list', wrap((req, res) => res.json(indexmon.list())));
router.post('/indexmon/check', wrap(async (req, res) => res.json(await indexmon.check(req.body.url))));
router.post('/indexmon/submit', wrap(async (req, res) => res.json(await indexmon.submit(req.body.url))));
router.post('/indexmon/monitor', wrap(async (req, res) => res.json(await indexmon.monitorRecent(+req.body?.limit || 5))));

// ---- Internal linking + distribution --------------------------------------
router.get('/interlink/orphans', wrap(async (req, res) => res.json(await interlink.orphans({ limit: +req.query.limit || 200 }))));
router.post('/interlink/auto', wrap(async (req, res) => res.json(await interlink.autoLinkArticle(req.body.articleId))));
router.get('/distribute/status', wrap((req, res) => res.json(distribute.status())));
router.post('/distribute/test', wrap(async (req, res) => res.json(await distribute.notify('test', 'Test notification from WP Autopilot ✅', { level: 'info' }))));

// ---- Supabase: cloud persistence + multi-tenant foundation ----------------
router.get('/supabase/status', wrap(async (req, res) => res.json({ ...backup.status(), schemaReady: await backup.schemaReady() })));
// Generated first-class schema SQL (one table per entity) for the SQL editor.
router.get('/supabase/schema-sql', wrap(async (req, res) => {
  const { schemaSql } = await import('../services/cloudschema.js');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="wp-autopilot-supabase-schema.sql"');
  res.send(schemaSql());
}));
router.post('/supabase/test', wrap(async (req, res) => res.json(await supabase.ping())));
router.post('/supabase/backup', wrap(async (req, res) => res.json(await backup.run())));
router.post('/supabase/restore', wrap(async (req, res) => res.json(await backup.restore())));

// ---- Google Search Console ------------------------------------------------
router.get('/gsc/status', wrap((req, res) => res.json({
  configured: gsc.configured(),
  hasClient: !!cfg.get('gsc_client_id'),
  site: cfg.get('gsc_site_url'),
  redirectUri: redirectUri(req),
})));
router.get('/gsc/auth-url', wrap((req, res) => res.json({ url: gsc.authUrl(redirectUri(req)) })));
router.get('/gsc/callback', wrap(async (req, res) => {
  const page = (title, body) => `<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;background:#0f1216;color:#e7edf3;text-align:center;padding:50px 24px;line-height:1.6">${title}${body}</body>`;
  // Google can return the error in the query string (e.g. access_denied).
  if (req.query.error) {
    return res.send(page(`<h2>❌ Authorisation failed</h2>`,
      `<p><code>${esc(req.query.error)}</code>${req.query.error_description ? ` — ${esc(req.query.error_description)}` : ''}</p>
       <p>You can close this tab and try again.</p>`));
  }
  try {
    await gsc.exchangeCode(req.query.code, redirectUri(req));
    log.info('gsc', 'connected to Search Console');
    return res.send(page(`<h2>✅ Search Console connected</h2>`,
      `<p>You can close this tab and return to WP Autopilot.</p><script>setTimeout(()=>{window.location='/#searchconsole'},1500)</script>`));
  } catch (e) {
    log.warn('gsc', `OAuth exchange failed: ${e.message}`);
    return res.send(page(`<h2>❌ Couldn't finish connecting</h2>`,
      `<p style="color:#f0685f"><b>${esc(e.message)}</b></p>
       <div style="text-align:left;max-width:560px;margin:18px auto;background:#161b22;border:1px solid #29313c;border-radius:10px;padding:16px">
         <p><b>Most common fixes:</b></p>
         <p>• <b>redirect_uri_mismatch</b> → in Google Cloud Console → Credentials → open your OAuth client → <b>Authorized redirect URIs</b> → add exactly:<br><code>${esc(redirectUri(req))}</code> → Save, wait a minute, retry.</p>
         <p>• <b>invalid_client</b> → the Client ID and Secret in Settings don't belong to the same OAuth client. Re-copy both from the same client.</p>
         <p>• <b>access_denied / app not verified</b> → on the consent screen click <b>Advanced → Go to (app) (unsafe)</b>, or add your email as a Test user.</p>
       </div>
       <p>Close this tab, fix the above, and click Reconnect.</p>`));
  }
}));
router.get('/gsc/sites', wrap(async (req, res) => res.json(await gsc.listSites())));
router.get('/gsc/overview', wrap(async (req, res) => res.json(await insights.overview(+req.query.days || 28))));
router.get('/gsc/recommendations', wrap(async (req, res) => res.json(await insights.recommendations(+req.query.days || 28))));
router.post('/gsc/to-ideas', wrap((req, res) => res.json({ added: insights.striveToIdeas(req.body.queries || []) })));
router.get('/gsc/inspect', wrap(async (req, res) => res.json(await gsc.inspectUrl(req.query.url))));

// ---- GSC ↔ WP optimization engine -----------------------------------------
router.post('/optimize/scan', wrap(async (req, res) => res.json(await optimize.scan(+req.body?.days || 28))));
router.get('/optimize/list', wrap((req, res) => res.json(optimize.listOptimizations(req.query.status))));
router.get('/optimize/:id', wrap((req, res) => res.json(optimize.getOptimization(req.params.id))));
router.post('/optimize/ctr', wrap(async (req, res) => res.json(await optimize.prepareCtr(req.body.url))));
router.post('/optimize/refresh', wrap(async (req, res) => res.json(await optimize.prepareRefresh(req.body.url))));
router.post('/optimize/regenerate', wrap(async (req, res) => res.json(await optimize.prepareRegenerate(req.body.url))));
router.post('/optimize/destuff', wrap(async (req, res) => res.json(await optimize.prepareDestuff(req.body.url))));
router.post('/optimize/gap', wrap(async (req, res) => res.json(await optimize.gapToIdea(req.body.query, { generate: req.body.generate }))));
router.post('/optimize/:id/apply', wrap(async (req, res) => res.json(await optimize.apply(req.params.id))));
router.post('/optimize/:id/dismiss', wrap((req, res) => res.json(optimize.dismiss(req.params.id))));

// ---- Site: themes & plugins -----------------------------------------------
router.get('/wp/plugins', wrap(async (req, res) => {
  const list = await wp.listPlugins();
  res.json(list.map((p) => ({ plugin: p.plugin, name: p.name, status: p.status, version: p.version, author: p.author?.replace?.(/<[^>]+>/g, '') || p.author })));
}));
router.post('/wp/plugins/toggle', wrap(async (req, res) => res.json(await wp.togglePlugin(req.body.plugin, req.body.active))));
router.post('/wp/plugins/install', wrap(async (req, res) => res.json(await wp.installPlugin(req.body.slug, req.body.activate !== false))));
// Deep capability probe — what can the agent actually do on this site?
router.get('/wp/diagnostics', wrap(async (req, res) => res.json(await diagnostics.run())));
// Site settings (read / update — needs manage_options).
router.get('/wp/settings', wrap(async (req, res) => res.json(await wp.getSiteSettings())));
router.post('/wp/settings', wrap(async (req, res) => res.json(await wp.updateSiteSettings(req.body || {}))));
// Comments moderation.
router.get('/wp/comments', wrap(async (req, res) => {
  const list = await wp.listComments({ per_page: 50 });
  res.json(list.map((c) => ({ id: c.id, author: c.author_name, content: (c.content?.rendered || '').replace(/<[^>]+>/g, '').slice(0, 200), status: c.status, post: c.post, date: c.date, link: c.link })));
}));
router.post('/wp/comments/:id/moderate', wrap(async (req, res) => res.json(await wp.moderateComment(req.params.id, req.body.status))));
// Browse live WordPress content (posts/pages/media/comments) with pagination.
router.get('/wp/content/:type', wrap(async (req, res) => {
  const type = req.params.type;
  const { page = 1, per_page, status, search } = req.query;
  // Sorting (whitelisted so WP REST never rejects it).
  const orderby = ['date', 'title', 'modified'].includes(req.query.orderby) ? req.query.orderby : 'date';
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  if (type === 'comments') {
    const list = await wp.listComments({ page, per_page: per_page || 20, ...(status ? { status } : {}) });
    return res.json({ items: list.map((c) => ({ id: c.id, title: c.author_name, excerpt: (c.content?.rendered || '').replace(/<[^>]+>/g, '').slice(0, 160), status: c.status, link: c.link, date: c.date })), page: +page, totalPages: 1, total: list.length });
  }
  // Translate the UI's "any" into an explicit status list (older WP rejects "any").
  let statusList;
  if (type === 'posts' || type === 'pages') {
    statusList = (!status || status === 'any') ? 'publish,draft,pending,future,private' : status;
  }
  const pp = per_page || (type === 'media' ? 12 : 10);
  let r, limited = false;
  if (type === 'media') {
    r = await wp.browse('media', { page, per_page: pp, search, context: 'view' });
  } else {
    try {
      // Full visibility (drafts etc.) — needs edit rights on the connected user.
      r = await wp.browse(type, { page, per_page: pp, status: statusList, search, orderby, order, context: 'edit' });
    } catch (e) {
      // Fall back to public/published view so the browser still works for
      // read-only or limited-capability connections.
      limited = true;
      r = await wp.browse(type, { page, per_page: pp, search, orderby, order, context: 'view' });
    }
  }
  const items = r.items.map((p) => ({
    id: p.id,
    title: p.title?.rendered || p.title?.raw || (type === 'media' ? p.slug : '(untitled)'),
    slug: p.slug,
    status: p.status,
    link: p.link || p.source_url,
    source_url: p.source_url,
    mime: p.mime_type,
    date: (p.date || '').slice(0, 10),
    type: p.media_type || type,
  }));
  res.json({ items, page: r.page, totalPages: r.totalPages, total: r.total, limited });
}));

// Operations on live content.
router.post('/wp/posts/:id/status', wrap(async (req, res) => res.json(await wp.setPostStatus(req.params.id, req.body.status))));
router.post('/wp/pages/:id/status', wrap(async (req, res) => res.json(await wp.setPageStatus(req.params.id, req.body.status))));
router.delete('/wp/posts/:id', wrap(async (req, res) => res.json(await wp.trashPost(req.params.id, req.query.force === 'true'))));
router.delete('/wp/pages/:id', wrap(async (req, res) => res.json(await wp.trashPage(req.params.id, req.query.force === 'true'))));
router.delete('/wp/media/:id', wrap(async (req, res) => res.json(await wp.deleteMedia(req.params.id))));

// Live Rank Math score + focus keyword for a post (if Rank Math exposes its meta).
router.get('/wp/rankmath/:id', wrap(async (req, res) => res.json(await wp.getRankMath(req.params.id, req.query.type || 'posts'))));
// One post/page with full content + meta, for the WordPress detail view.
router.get('/wp/item/:type/:id', wrap(async (req, res) => {
  const type = req.params.type === 'pages' ? 'pages' : 'posts';
  const item = await wp.getItem(type, req.params.id);
  let rankMath = null;
  try { rankMath = await wp.getRankMath(req.params.id, type); } catch { /* meta not exposed */ }
  res.json({
    id: item.id, type,
    title: item.title?.rendered || item.title?.raw || '(untitled)',
    slug: item.slug,
    status: item.status,
    link: item.link,
    date: item.date,
    modified: item.modified,
    excerpt: (item.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim(),
    content: item.content?.rendered || item.content?.raw || '',
    rankMath,
  });
}));
// Detect installed SEO plugins (Rank Math etc.) and whether the score is readable
// over REST natively — so we don't push a companion plugin that isn't needed.
router.get('/wp/seo-detect', wrap(async (req, res) => {
  const plugins = await wp.listPlugins().catch(() => []);
  const find = (re) => plugins.find((p) => re.test(`${p.name || ''} ${p.plugin || ''}`));
  const rm = find(/rank-?math(?!.*pro)/i) || find(/rank ?math seo/i);
  const rmPro = find(/rank-?math.*pro/i);
  const yoast = find(/yoast|wordpress seo/i);
  const aioseo = find(/all in one seo|aioseo/i);
  let nativeScoreReadable = false, sampleId = null, bridge = false;
  try {
    const list = await wp.browse('posts', { per_page: 1, status: 'publish', context: 'view' });
    if (list.items.length) {
      sampleId = list.items[0].id;
      const m = await wp.getRankMath(sampleId);
      nativeScoreReadable = !!m.hasMeta;
    }
  } catch { /* ignore */ }
  try { await wp.rankMathScores([sampleId].filter(Boolean)); bridge = true; } catch { bridge = false; }
  res.json({
    rankMath: rm ? { name: rm.name, version: rm.version, active: rm.status === 'active' } : null,
    rankMathPro: rmPro ? { version: rmPro.version, active: rmPro.status === 'active' } : null,
    yoast: yoast ? { name: yoast.name, active: yoast.status === 'active' } : null,
    aioseo: aioseo ? { name: aioseo.name, active: aioseo.status === 'active' } : null,
    nativeScoreReadable, bridge, sampleId,
  });
}));
// Bulk live Rank Math scores via the companion plugin. Returns {bridge:false} if missing.
router.get('/wp/rankmath-scores', wrap(async (req, res) => {
  const ids = (req.query.ids || '').split(',').map((x) => parseInt(x, 10)).filter(Boolean);
  try {
    const scores = await wp.rankMathScores(ids);
    res.json({ bridge: true, scores });
  } catch (e) {
    // Best-effort enhancement: any failure (plugin missing, 403/404, not connected)
    // just means "no live scores" — never surface it as an error.
    res.json({ bridge: false, scores: [], reason: e.message });
  }
}));
// Dynamic theme intelligence — detect + AI-understand the active theme.
router.get('/theme', wrap((req, res) => res.json(themeintel.profile())));
router.post('/theme/analyze', wrap(async (req, res) => res.json(await themeintel.analyze())));
router.get('/wp/themes', wrap(async (req, res) => {
  const list = await wp.listThemes();
  res.json(list.map((t) => ({
    stylesheet: t.stylesheet,
    name: t.name?.rendered || t.name,
    status: t.status,
    version: t.version,
    author: (t.author?.rendered || t.author || '').replace(/<[^>]+>/g, ''),
  })));
}));

// ---- SEO Strategy ---------------------------------------------------------
router.get('/strategy/audit', wrap((req, res) => res.json(strategy.getAudit())));
router.post('/strategy/audit', wrap(async (req, res) => res.json(await strategy.audit())));
router.get('/strategy/doc', wrap((req, res) => res.json(strategy.getStrategy())));
router.post('/strategy/doc', wrap((req, res) => res.json(strategy.saveStrategy(req.body))));

// ---- Content stats --------------------------------------------------------
router.get('/stats', wrap((req, res) => res.json(stats.summary())));
router.get('/stats/performance', wrap(async (req, res) => res.json(await stats.performance(+req.query.days || 28))));

// ---- Logs -----------------------------------------------------------------
router.get('/logs', wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(req.query.limit || 200);
  res.json(rows);
}));

export default router;
