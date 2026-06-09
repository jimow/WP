// Declarative settings schema — the SINGLE source of truth for every owner-
// configurable behavior. Nothing about "what the agent does" is hard-coded:
// defaults live here, the dashboard auto-generates from here, and (for the future
// multi-tenant SaaS) each tenant simply stores their own values against this
// schema. To add a new owner control, add a field here — the UI updates itself.
//
// field: { key, label, type, default, options?, help?, secret?, placeholder?, env? }
// type:  text | password | number | textarea | select | toggle

export const SCHEMA = [
  {
    group: 'Connections — WordPress',
    fields: [
      { key: 'wp_base_url', label: 'Site URL', type: 'text', default: '', placeholder: 'https://yoursite.com', env: 'WP_BASE_URL' },
      { key: 'wp_username', label: 'Username', type: 'text', default: '', env: 'WP_USERNAME' },
      { key: 'wp_app_password', label: 'Application password', type: 'password', default: '', secret: true, env: 'WP_APP_PASSWORD' },
    ],
    actions: [{ label: 'Test connection', fn: 'testConn', arg: 'wordpress' }, { label: 'Diagnostics', fn: 'wpDiagnostics' }],
  },
  {
    group: 'Connections — Ahrefs & AI',
    fields: [
      { key: 'ahrefs_api_token', label: 'Ahrefs API token', type: 'password', default: '', secret: true, env: 'AHREFS_API_TOKEN', help: 'Powers the 🔗 Ahrefs tab: keyword research, competitor SERP analysis, backlinks, referring domains, domain metrics, organic keywords & top pages — for your site or any competitor. (Ahrefs API is a paid add-on billed in API units.)' },
      { key: 'ai_provider', label: 'AI provider', type: 'select', default: 'anthropic', options: [['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI'], ['deepseek', 'DeepSeek']], env: 'AI_PROVIDER' },
      { key: 'ai_model', label: 'AI model', type: 'text', default: 'claude-sonnet-4-6', placeholder: 'claude-sonnet-4-6 / gpt-5.5 / deepseek-v4-flash / deepseek-v4-pro', env: 'AI_MODEL' },
      { key: 'anthropic_api_key', label: 'Anthropic API key', type: 'password', default: '', secret: true, env: 'ANTHROPIC_API_KEY' },
      { key: 'openai_api_key', label: 'OpenAI API key', type: 'password', default: '', secret: true, env: 'OPENAI_API_KEY' },
      { key: 'deepseek_api_key', label: 'DeepSeek API key', type: 'password', default: '', secret: true, env: 'DEEPSEEK_API_KEY' },
    ],
    actions: [{ label: 'Test Ahrefs', fn: 'testConn', arg: 'ahrefs' }, { label: 'Test AI', fn: 'testConn', arg: 'ai' }],
  },
  {
    group: 'Supabase (cloud persistence & multi-tenancy)',
    help: 'Cloud persistence of all your content to Supabase (Postgres) — survives machine loss and powers multi-tenant SaaS. For security the credentials live ONLY in your .env file (never in this dashboard/database). Set SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_ANON_KEY in .env, run the downloadable schema in your Supabase SQL editor, then back up.',
    fields: [
      // SECRETS — read from .env only (envOnly: shown as status, never saved to the DB).
      { key: 'supabase_url', label: 'Project URL', type: 'text', default: '', env: 'SUPABASE_URL', envOnly: true },
      { key: 'supabase_service_key', label: 'service_role key (server)', type: 'password', default: '', secret: true, env: 'SUPABASE_SERVICE_KEY', envOnly: true },
      { key: 'supabase_anon_key', label: 'anon key', type: 'password', default: '', secret: true, env: 'SUPABASE_ANON_KEY', envOnly: true },
      // Non-secret behaviour toggles (still dashboard-editable).
      { key: 'supabase_primary', label: 'Use Supabase as the primary store', type: 'toggle', default: 'false', env: 'SUPABASE_PRIMARY', help: 'When ON (and connected via .env): the app hydrates from Supabase on boot and mirrors every change up continuously — Supabase becomes the source of truth, the local DB a cache. Turn ON only AFTER your first "Back up now" so the cloud has your data.' },
      { key: 'supabase_workspace_id', label: 'Default workspace tag', type: 'text', default: 'default' },
      { key: 'supabase_auto_backup', label: 'Auto-backup daily', type: 'toggle', default: 'false' },
    ],
    actions: [
      { label: 'Test connection', fn: 'supabaseTest' },
      { label: '☁ Back up now', fn: 'supabaseBackup' },
      { label: '⬇ Restore', fn: 'supabaseRestore' },
      { label: 'Download schema SQL', fn: 'supabaseSchema' },
    ],
  },
  {
    group: 'Connections — Google Search Console',
    fields: [
      { key: 'gsc_client_id', label: 'OAuth Client ID', type: 'text', default: '', env: 'GSC_CLIENT_ID' },
      { key: 'gsc_client_secret', label: 'OAuth Client Secret', type: 'password', default: '', secret: true, env: 'GSC_CLIENT_SECRET' },
      { key: 'gsc_site_url', label: 'Property URL', type: 'text', default: '', placeholder: 'https://yoursite.com/ or sc-domain:yoursite.com', env: 'GSC_SITE_URL' },
    ],
    actions: [{ label: 'Open Search Console', fn: 'navigate', arg: 'searchconsole' }],
  },
  {
    group: 'Brand & content',
    fields: [
      { key: 'brand_name', label: 'Brand name', type: 'text', default: '' },
      { key: 'site_topic', label: 'Site topic / niche', type: 'text', default: '', placeholder: 'e.g. math & ML tutorials for beginners' },
      { key: 'tone', label: 'Writing tone', type: 'textarea', default: 'professional, helpful, concise' },
      { key: 'use_latex', label: 'Use LaTeX for math/formulas', type: 'toggle', default: 'false' },
      { key: 'content_instructions', label: 'Custom content instructions (your rules, applied to every article)', type: 'textarea', default: '', placeholder: 'e.g. always include a worked numpy example; never use the word "delve"; UK spelling…' },
      { key: 'target_country', label: 'Target country code', type: 'text', default: 'us', placeholder: 'us, ke, gb…' },
      { key: 'language', label: 'Language', type: 'text', default: 'en' },
      { key: 'words_min', label: 'Min words', type: 'number', default: '1600' },
      { key: 'words_max', label: 'Max words', type: 'number', default: '2200' },
      { key: 'default_category', label: 'Default post category', type: 'text', default: '' },
    ],
  },
  {
    group: 'Automation — what the agent runs',
    help: 'You control exactly what the 24/7 worker does, how often, and how much. Nothing runs unless you enable it.',
    fields: [
      { key: 'automation_enabled', label: 'Automation master switch', type: 'toggle', default: 'false' },
      { key: 'tick_cron', label: 'Schedule (cron)', type: 'text', default: '*/15 * * * *', help: 'How often the worker wakes up.' },
      { key: 'autonomy', label: 'Autonomy', type: 'select', default: 'draft_approve', options: [['draft_approve', 'Draft → I approve (safest)'], ['auto_articles', 'Auto-publish articles only'], ['full_auto', 'Full auto']] },
      { key: 'publish_status', label: 'When publishing', type: 'select', default: 'publish', options: [['publish', 'Publish live'], ['draft', 'Save as WP draft']] },
      { key: 'articles_per_day', label: 'Articles per day (max)', type: 'number', default: '3' },
      { key: 'pipeline_generate', label: 'Step: generate drafts', type: 'toggle', default: 'true' },
      { key: 'pipeline_publish', label: 'Step: publish approved', type: 'toggle', default: 'true' },
      { key: 'auto_optimize', label: 'Step: prepare GSC fixes', type: 'toggle', default: 'false' },
      { key: 'optimize_per_day', label: 'Optimizations per day (max)', type: 'number', default: '2' },
    ],
  },
  {
    group: 'Self-replenish & editorial calendar',
    help: 'Keep the 24/7 loop fed and spread publishing over time so it never dumps or starves.',
    fields: [
      { key: 'auto_replenish', label: 'Auto-refill the idea queue', type: 'toggle', default: 'false', help: 'When the idea queue runs low, research fresh non-duplicate keywords (GSC gaps → Ahrefs → AI).' },
      { key: 'min_idea_queue', label: 'Refill when ideas drop below', type: 'number', default: '5' },
      { key: 'replenish_batch', label: 'Extra ideas to add per refill', type: 'number', default: '5' },
      { key: 'replenish_seeds', label: 'Seed keywords/topics for research', type: 'textarea', default: '', placeholder: 'one per line — leave blank to use the site topic' },
      { key: 'publish_cadence', label: 'Publishing cadence', type: 'select', default: 'immediate', options: [['immediate', 'Publish immediately'], ['scheduled', 'Schedule across the day (editorial calendar)']] },
      { key: 'publish_times', label: 'Daily publish times (scheduled mode)', type: 'text', default: '09:00,14:00', help: '24h, comma-separated. Posts fill these slots, spilling to following days.' },
    ],
  },
  {
    group: 'Auto content-gap analysis (existing pages)',
    help: 'On its own schedule, the worker takes each existing article’s focus keyword, looks up the live Google top-10 (via Ahrefs), scrapes them, and saves an analysis of what they cover that you don’t — with apply-ready edits. Results appear on each article (🔬 Analyze panel). Runs a few at a time so it never hammers anything; skips quietly when Ahrefs/the site is unreachable.',
    fields: [
      { key: 'auto_gap_analysis', label: 'Step: auto-analyze existing content vs Google top-10', type: 'toggle', default: 'false' },
      { key: 'gap_analysis_per_tick', label: 'Articles to analyze per run', type: 'number', default: '2' },
      { key: 'gap_analysis_interval_days', label: 'Re-analyze each article every (days)', type: 'number', default: '30' },
    ],
  },
  {
    group: 'Opportunity rules (you set the thresholds)',
    help: 'Define what counts as an opportunity. The agent acts only within these owner-set bounds.',
    fields: [
      { key: 'opt_min_impressions', label: 'Min impressions to act on', type: 'number', default: '30' },
      { key: 'opt_pos_min', label: 'Striking-distance: min position', type: 'number', default: '8' },
      { key: 'opt_pos_max', label: 'Striking-distance: max position', type: 'number', default: '20' },
      { key: 'opt_ctr_ratio', label: 'Low-CTR trigger (actual vs expected, 0–1)', type: 'number', default: '0.6' },
      { key: 'gap_min_position', label: 'Content gap: weaker than position', type: 'number', default: '15' },
    ],
  },
  {
    group: 'Rank tracking & decay refresh',
    help: 'Snapshot positions daily and auto-refresh pages that slip, closing the measure→improve loop over time.',
    fields: [
      { key: 'rank_tracking', label: 'Track positions daily (snapshot)', type: 'toggle', default: 'false' },
      { key: 'rank_window_days', label: 'GSC window for positions (days)', type: 'number', default: '28' },
      { key: 'auto_refresh_decliners', label: 'Auto-refresh pages that slip', type: 'toggle', default: 'false' },
      { key: 'rank_decline_threshold', label: 'Slip threshold (positions dropped)', type: 'number', default: '3' },
    ],
  },
  {
    group: 'Hub & spoke planning',
    fields: [
      { key: 'clusters_default', label: 'Default clusters', type: 'number', default: '3' },
      { key: 'spokes_per_cluster', label: 'Spokes per cluster', type: 'number', default: '6' },
      { key: 'cluster_intent', label: 'Default intent', type: 'select', default: 'mixed', options: [['mixed', 'Mixed'], ['informational', 'Informational'], ['commercial', 'Commercial'], ['transactional', 'Transactional']] },
    ],
  },
  {
    group: 'SEO requirements (Rank Math)',
    help: 'Every generated article is written to satisfy these and scored against them.',
    fields: [
      { key: 'seo_min_score', label: 'Target Rank Math score (auto-fix until met)', type: 'number', default: '80' },
      { key: 'seo_max_fix_attempts', label: 'Max self-correction passes', type: 'number', default: '2' },
      { key: 'seo_internal_links', label: 'Min internal links', type: 'number', default: '3' },
      { key: 'seo_external_links', label: 'Min external links', type: 'number', default: '2' },
      { key: 'seo_keyword_density', label: 'Target keyword density %', type: 'text', default: '1.1' },
      { key: 'seo_density_min', label: 'Min acceptable density %', type: 'text', default: '1.0' },
      { key: 'seo_density_max', label: 'Max acceptable density % (over = stuffing, auto-fixed)', type: 'text', default: '1.2' },
      { key: 'seo_require_toc', label: 'Table of Contents', type: 'toggle', default: 'true' },
      { key: 'seo_require_faq', label: 'FAQ section (schema)', type: 'toggle', default: 'true' },
      { key: 'seo_require_key_takeaways', label: 'Key Takeaways box', type: 'toggle', default: 'true' },
      { key: 'rich_presentation', label: 'Rich visual components (callouts, tips, cards, stat boxes, related-reading)', type: 'toggle', default: 'true', help: 'Adds magazine-style styled boxes using your theme’s accent colour: TL;DR, Quick Answer, Key Takeaways, Pro tips, ℹ️ notes, ⭐ important, 📖 definitions, ✅/❌ pros & cons, warnings, 🧪 worked examples, comparison tables, checklists, “Did you know?”, expert insight, stat/step cards, pull quotes, and a Keep-reading link card. They render via inline-styled blocks, so they look right on any theme.' },
      { key: 'presentation_style', label: 'Presentation richness', type: 'select', default: 'rich', options: [['minimal', 'Minimal (3–4 components)'], ['standard', 'Standard (5–7)'], ['rich', 'Rich (8–11, magazine-style)']], help: 'How many of the visual components the writer should use. Minimal keeps it clean; Rich produces a varied magazine-style layout.' },
      { key: 'seo_title_number', label: 'Number in title', type: 'toggle', default: 'true' },
      { key: 'seo_title_power_word', label: 'Power word in title', type: 'toggle', default: 'true' },
      { key: 'seo_image_alt', label: 'Suggest images + alt text', type: 'toggle', default: 'true' },
      { key: 'rankmath_meta', label: 'Write Rank Math meta on publish', type: 'toggle', default: 'true' },
      { key: 'inject_schema', label: 'Inject schema (Article + FAQ + HowTo JSON-LD)', type: 'toggle', default: 'true', help: 'Adds structured data to the post so it can earn rich results (FAQ accordions, How-To steps) regardless of SEO-plugin config.' },
    ],
  },
  {
    group: 'Internal linking & distribution',
    help: 'Automatically weave internal links on publish, and announce posts / alerts to a webhook (Zapier, Make, Buffer, Slack, Discord) that fans out to social or email.',
    fields: [
      { key: 'auto_interlink', label: 'Auto internal-link on publish', type: 'toggle', default: 'false' },
      { key: 'interlink_max', label: 'Max forward links to add', type: 'number', default: '3' },
      { key: 'interlink_reverse', label: 'Add a reverse link (de-orphan new posts)', type: 'toggle', default: 'true' },
      { key: 'share_webhook_url', label: 'Share webhook URL (social/email amplify)', type: 'text', default: '', placeholder: 'https://hooks.zapier.com/… or a Slack/Discord incoming webhook' },
      { key: 'notify_webhook_url', label: 'Notifications webhook URL', type: 'text', default: '', placeholder: 'Slack/Discord/Zapier — errors, alerts, approvals' },
      { key: 'notify_errors', label: 'Send error/alert notifications', type: 'toggle', default: 'true' },
      { key: 'notify_publish', label: 'Notify when posts go live', type: 'toggle', default: 'false' },
    ],
  },
  {
    group: 'Fast indexing (Google Indexing API)',
    help: 'Ping Google to crawl new/updated posts immediately, and monitor what gets indexed. Needs a Google service account added as an Owner of your Search Console property.',
    fields: [
      { key: 'indexing_enabled', label: 'Ping Indexing API on publish', type: 'toggle', default: 'false' },
      { key: 'indexing_service_account', label: 'Indexing API service account (paste JSON key)', type: 'textarea', default: '', secret: true, env: 'INDEXING_SERVICE_ACCOUNT', placeholder: '{ "type": "service_account", "client_email": "...", "private_key": "-----BEGIN PRIVATE KEY-----\\n..." }' },
      { key: 'indexing_monitor', label: 'Monitor index coverage (URL Inspection)', type: 'toggle', default: 'false' },
      { key: 'index_check_per_tick', label: 'URLs to inspect per run', type: 'number', default: '3' },
    ],
  },
  {
    group: 'Featured images',
    fields: [
      { key: 'auto_featured_image', label: 'AI featured image on publish', type: 'toggle', default: 'false' },
      { key: 'image_model', label: 'Image model', type: 'text', default: 'gpt-image-1', placeholder: 'gpt-image-1 / dall-e-3' },
    ],
  },
  {
    group: 'Theme & layout (per published post)',
    help: 'Optional — leave blank to keep the theme default. Set these to control the per-post layout via the theme. Values shown suit Astra; other themes use their own meta. Run “Detect & understand theme” in the Pages tab.',
    fields: [
      { key: 'post_sidebar_layout', label: 'Sidebar layout', type: 'select', default: '', options: [['', 'Theme default'], ['no-sidebar', 'No sidebar'], ['left-sidebar', 'Left sidebar'], ['right-sidebar', 'Right sidebar']] },
      { key: 'post_content_layout', label: 'Content width', type: 'select', default: '', options: [['', 'Theme default'], ['plain-container', 'Full width / stretched'], ['content-boxed-container', 'Boxed'], ['page-builder', 'Page builder (no container)']] },
      { key: 'page_template', label: 'Default template for new pages', type: 'text', default: '', placeholder: 'e.g. (blank) or a theme template slug' },
    ],
  },
  {
    group: 'Human-quality content (E-E-A-T)',
    help: 'Makes generated articles read as genuinely human & trustworthy.',
    fields: [
      { key: 'humanize', label: 'Humanize writing', type: 'toggle', default: 'true' },
      { key: 'human_first_person', label: 'First-hand experience voice', type: 'toggle', default: 'true' },
      { key: 'human_examples', label: 'Require worked examples & analogies', type: 'toggle', default: 'true' },
      { key: 'author_name', label: 'Author name (byline / expertise)', type: 'text', default: '' },
      { key: 'author_bio', label: 'Author bio (short expertise blurb)', type: 'textarea', default: '' },
    ],
  },
];

// Internal, app-managed values (not shown as editable fields).
export const INTERNAL = {
  gsc_refresh_token: '',
  strategy_doc: '',
  last_audit: '',
  theme_profile: '',
  supabase_last_backup: '',
  session_secret: '',
};

export function defaultsFromSchema() {
  const out = { ...INTERNAL };
  for (const group of SCHEMA) for (const f of group.fields) out[f.key] = f.default;
  return out;
}
export function secretsFromSchema() {
  const out = ['gsc_refresh_token'];
  for (const group of SCHEMA) for (const f of group.fields) if (f.secret) out.push(f.key);
  return out;
}
export function envMap() {
  const out = {};
  for (const group of SCHEMA) for (const f of group.fields) if (f.env) out[f.key] = f.env;
  return out;
}

export default SCHEMA;
