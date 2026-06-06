// Dynamic theme intelligence — NO hard-coded per-theme logic. It:
//   1) detects the active theme + what's editable (block/FSE vs classic) from the
//      live REST API capabilities,
//   2) extracts the theme's REAL design tokens (CSS variables, colors, fonts,
//      container width) from the rendered site,
//   3) uses AI to UNDERSTAND it into a structured design profile,
// then that profile drives page/article design so output matches whatever theme
// is active — now or in the future.
import cfg from '../config.js';
import ai from '../clients/ai.js';
import log from '../log.js';

function creds() {
  const base = (cfg.get('wp_base_url') || '').trim().replace(/\/+$/, '');
  const user = (cfg.get('wp_username') || '').trim();
  const pass = (cfg.get('wp_app_password') || '').replace(/\s+/g, '');
  return { base, auth: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') };
}

// 1) Capability detection from the REST API (no assumptions about the theme).
export async function detect() {
  const { base, auth } = creds();
  if (!base) throw new Error('WordPress not configured.');
  const H = { Authorization: auth };
  const probe = async (ep) => { try { const r = await fetch(`${base}/wp-json${ep}`, { headers: H }); return r.ok; } catch { return false; } };

  let theme = null;
  try { const r = await fetch(`${base}/wp-json/wp/v2/themes?status=active`, { headers: H }); const d = await r.json(); theme = Array.isArray(d) ? d[0] : d; } catch { /* ignore */ }

  let blockPatterns = 0;
  try { const r = await fetch(`${base}/wp-json/wp/v2/block-patterns/patterns`, { headers: H }); const d = await r.json(); blockPatterns = Array.isArray(d) ? d.length : 0; } catch { /* ignore */ }

  return {
    name: theme?.name?.rendered || theme?.name || 'unknown',
    version: theme?.version || '',
    isBlockTheme: !!theme?.is_block_theme,
    templates: await probe('/wp/v2/templates'),
    templateParts: await probe('/wp/v2/template-parts'),
    globalStyles: await probe('/wp/v2/global-styles/themes'),
    blockPatterns,
  };
}

// 2) Pull real design tokens from the live site (works for ANY theme).
export async function extractTokens() {
  const { base } = creds();
  let html = '';
  try { const r = await fetch(base, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } }); html = await r.text(); } catch { /* ignore */ }
  let css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).join('\n');
  const links = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]).slice(0, 3);
  for (const href of links) {
    try {
      const u = href.startsWith('http') ? href : new URL(href, base).href;
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      css += '\n' + (await r.text()).slice(0, 40000);
    } catch { /* ignore */ }
  }
  const vars = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/g)) vars[m[1]] = m[2];
  const colors = [...new Set(Object.values(vars))].slice(0, 24);
  const fonts = [...new Set((css.match(/font-family\s*:\s*([^;}{]+)/gi) || []).map((s) => s.replace(/font-family\s*:\s*/i, '').trim()).filter((f) => f && !f.includes('var(') && f.length < 80))].slice(0, 8);
  const width = (css.match(/(?:--[a-z-]*container[a-z-]*|--[a-z-]*content[a-z-]*width[a-z-]*)\s*:\s*([0-9]+px)/i) || [])[1] || '';
  const snippet = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/\s+/g, ' ').slice(0, 2800);
  return { cssVars: vars, colors, fonts, containerWidth: width, htmlSnippet: snippet };
}

// 3) AI understands the theme into a design profile, and we store it.
export async function analyze() {
  const caps = await detect();
  const tok = await extractTokens();
  const patterns = await fetchPatterns();
  let out = {};
  try {
    out = await ai.json({
      system: 'You are a WordPress theme + web-design analyst. Produce a concise, accurate design profile so AI-generated page/article CONTENT (Gutenberg blocks) visually matches the active theme. Be specific to THIS theme using the evidence; never invent capabilities.',
      prompt: `Active theme: "${caps.name}" v${caps.version}. is_block_theme=${caps.isBlockTheme}.
REST endpoints available → templates:${caps.templates}, template-parts:${caps.templateParts}, global-styles:${caps.globalStyles}, block-patterns:${caps.blockPatterns}.
CSS custom properties (sample): ${JSON.stringify(tok.cssVars).slice(0, 1400)}
Colors detected: ${tok.colors.join(', ') || 'n/a'}
Font families detected: ${tok.fonts.join(' | ') || 'n/a'}
Container width hint: ${tok.containerWidth || 'n/a'}
Rendered homepage snippet: ${tok.htmlSnippet}

Return JSON:
{
  "themeType": "block | classic | hybrid",
  "summary": "1-2 sentences about the theme and how to design within it",
  "editableViaApi": ["only what these endpoints actually allow, e.g. page content, page templates, (block themes:) templates & global styles"],
  "notEditableViaApi": ["e.g. header/footer & single-post template on a classic theme — needs Customizer/child theme/CSS"],
  "palette": [{"name":"primary|accent|text|bg|...","hex":"#......"}],
  "fonts": {"heading":"...","body":"..."},
  "containerWidth": "e.g. 1200px",
  "designGuidance": "3-5 sentences: concrete rules so generated content blocks look native (which colors for headings/links/CTAs, spacing, heading scale, which core blocks/patterns to prefer)",
  "recommendations": ["concrete actions to design pages/articles that match this theme"]
}`,
      maxTokens: 1600,
    });
  } catch (e) {
    log.warn('themeintel', `AI analysis failed: ${e.message}`);
    out = { themeType: caps.isBlockTheme ? 'block' : 'classic', summary: 'AI analysis unavailable; using detected tokens.', palette: tok.colors.slice(0, 6).map((h, i) => ({ name: `color-${i + 1}`, hex: h })), fonts: { heading: tok.fonts[0] || '', body: tok.fonts[1] || tok.fonts[0] || '' }, containerWidth: tok.containerWidth, designGuidance: '', recommendations: [] };
  }
  const profile = {
    ...out, theme: caps.name, themeVersion: caps.version, caps,
    tokens: { colors: tok.colors, fonts: tok.fonts, containerWidth: tok.containerWidth },
    patterns: patterns.slice(0, 60).map((p) => ({ name: p.name, title: p.title, categories: p.categories })),
    builtAt: new Date().toISOString(),
  };
  cfg.set('theme_profile', JSON.stringify(profile));
  log.info('themeintel', `Analysed theme "${caps.name}" → ${profile.themeType}`);
  return profile;
}

// Fetch the active theme's REAL block patterns (live, with markup) so pages can
// be built from genuine theme components.
export async function fetchPatterns() {
  const { base, auth } = creds();
  if (!base) return [];
  try {
    const r = await fetch(`${base}/wp-json/wp/v2/block-patterns/patterns`, { headers: { Authorization: auth } });
    const d = await r.json();
    if (!Array.isArray(d)) return [];
    return d.map((p) => ({ name: p.name, title: p.title, categories: p.categories || [], content: p.content || '' }));
  } catch { return []; }
}

// Fetch the theme's block-pattern categories.
export async function fetchPatternCategories() {
  const { base, auth } = creds();
  try {
    const r = await fetch(`${base}/wp-json/wp/v2/block-patterns/categories`, { headers: { Authorization: auth } });
    const d = await r.json();
    return Array.isArray(d) ? d.map((c) => ({ name: c.name, label: c.label })) : [];
  } catch { return []; }
}

export function profile() {
  const r = cfg.get('theme_profile');
  return r ? JSON.parse(r) : null;
}

// Compact catalog of the theme's patterns for a design prompt (titles by category).
export function patternsContext() {
  const p = profile();
  const pats = (p && p.patterns) || [];
  if (!pats.length) return '';
  const byCat = {};
  for (const x of pats) {
    const cat = (x.categories && x.categories[0]) || 'general';
    (byCat[cat] = byCat[cat] || []).push(x.title);
  }
  const lines = Object.entries(byCat).slice(0, 12).map(([c, titles]) => `- ${c}: ${titles.slice(0, 8).join(', ')}`);
  return `\nTHEME BLOCK PATTERNS available in "${p.theme}" (reuse their structure/style so the page looks native to the theme):\n${lines.join('\n')}`;
}

// A compact guidance block to inject into design-generation prompts.
export function designGuidance() {
  const p = profile();
  if (!p) return '';
  const pal = (p.palette || []).map((c) => `${c.name}:${c.hex}`).join(', ');
  return `\nMATCH THE ACTIVE THEME "${p.theme}" (${p.themeType}). Palette: ${pal || (p.tokens?.colors || []).join(', ')}. Fonts: heading "${p.fonts?.heading || ''}", body "${p.fonts?.body || ''}". Container ~${p.containerWidth || p.tokens?.containerWidth || '1200px'}. ${p.designGuidance || ''} Use core Gutenberg blocks; do NOT hard-code fonts that fight the theme — prefer the theme's colours for headings, links and CTAs.`;
}

export default { detect, extractTokens, fetchPatterns, fetchPatternCategories, analyze, profile, designGuidance, patternsContext };
