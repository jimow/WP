// SEO helpers modelled on Rank Math's on-page content analysis. Two jobs:
//  1) requirements(cfg) — turns the SEO settings into instructions + an output
//     spec the article generator must satisfy.
//  2) score({...}) — evaluates a finished article against the Rank Math-style
//     checklist and returns a 0-100 score plus per-check pass/fail for the UI.
import cfg from '../config.js';

// A trimmed set of Rank Math's recognised "power words".
export const POWER_WORDS = [
  'ultimate', 'essential', 'proven', 'complete', 'definitive', 'expert', 'best',
  'guaranteed', 'effortless', 'powerful', 'simple', 'practical', 'smart',
  'step-by-step', 'beginner', 'advanced', 'comprehensive', 'quick', 'easy',
  'free', 'top', 'must-have', 'effective', 'reliable',
];

const stripHtml = (s) => String(s || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Build the requirement block injected into the generation prompt.
// opts may override per-article values (e.g. words_min/words_max).
export function requirements(opts = {}) {
  const wmin = opts.words_min ? parseInt(opts.words_min, 10) : cfg.getInt('words_min', 1200);
  const wmax = opts.words_max ? parseInt(opts.words_max, 10) : cfg.getInt('words_max', 1800);
  // Turn the density band into a concrete keyword-count RANGE with a FLOOR (the
  // #1 reason drafts came in too LOW: only a ceiling was given). Size it to the
  // FULL expected word count — including the rich visual components, which add
  // words and dilute density — so the result lands inside the band.
  const densTarget = parseFloat(cfg.get('seo_keyword_density')) || 1.1;
  const densMin = parseFloat(cfg.get('seo_density_min')) || 1.0;
  const densMax = parseFloat(cfg.get('seo_density_max')) || 1.2;
  const expWords = cfg.getBool('rich_presentation') ? Math.round(wmax * 1.12) : wmax;
  const kwLo = Math.max(8, Math.ceil((densMin / 100) * expWords));
  const kwHi = Math.max(kwLo + 2, Math.floor((densMax / 100) * expWords));
  const kwMid = Math.round((kwLo + kwHi) / 2);
  const lines = [
    `Length: ${wmin}-${wmax} words of original, accurate, genuinely useful content.`,
    'Put the EXACT focus keyword in: the SEO title, the meta description, the URL slug, the first sentence (first 10% of the body), and 2-3 different H2/H3 subheadings.',
    `KEYWORD DENSITY — REQUIRED (${densMin}–${densMax}%): use the EXACT focus-keyword phrase between ${kwLo} and ${kwHi} times across the whole body — AIM for about ${kwMid}. Do NOT go below ${kwLo} (too few hurts ranking just as much as stuffing). Distribute them naturally: the first sentence, 2-3 subheadings, the image alt text, the first and the last paragraph, and sprinkled through the body. Use synonyms/pronouns for the REST of the mentions so it still reads naturally — but the EXACT phrase must appear at least ${kwLo} times.`,
    'Structure with a short compelling intro, scannable H2/H3 sections, short paragraphs (2-4 sentences), and at least one bulleted or numbered list.',
    'READABILITY — aim for a Flesch Reading Ease of 60+: keep most sentences under 20 words, prefer simple everyday words over jargon (explain any necessary technical term), use the ACTIVE voice, and connect ideas with TRANSITION words ("however", "for example", "in short", "as a result", "next", "because", "that said") in roughly a third of sentences. Vary sentence length for natural rhythm; never write a paragraph longer than ~4 sentences.',
    `Include at least ${cfg.getInt('seo_internal_links', 3)} internal links (to the hub and sibling articles) and ${cfg.getInt('seo_external_links', 2)} external links to authoritative sources (DoFollow).`,
  ];
  if (cfg.getBool('seo_require_toc')) lines.push('Start with a "Table of Contents" list linking to the section anchors.');
  if (cfg.getBool('seo_require_key_takeaways')) lines.push('Add a "Key Takeaways" summary box (a short bulleted list) near the top.');
  if (cfg.getBool('seo_require_faq')) lines.push('End with an "FAQ" section of 3-5 question H3s with concise answers (also return them in the faq field for schema).');
  if (cfg.getBool('seo_title_number')) lines.push('Use a number in the SEO title where natural (e.g. "7 Ways…", "2026 Guide").');
  if (cfg.getBool('seo_title_power_word')) lines.push(`Use a power word in the title (e.g. ${POWER_WORDS.slice(0, 8).join(', ')}). Keep the title 50-60 characters.`);
  // Title MUST carry sentiment (a distinct Rank Math test).
  lines.push(`The SEO title MUST contain a positive or negative SENTIMENT word (e.g. ${SENTIMENT_WORDS.slice(0, 10).join(', ')}).`);
  if (cfg.getBool('seo_image_alt')) {
    lines.push('Include at least ONE <!-- wp:image --> block whose <img> has src="{{HERO_IMAGE}}" and alt text containing the EXACT focus keyword (e.g. <img src="{{HERO_IMAGE}}" alt="focus keyword — short description"/>). Leave src exactly as {{HERO_IMAGE}}; a real image is inserted automatically on publish. This satisfies BOTH the "image with focus keyword alt" and "rich media (images/videos)" tests.');
    lines.push('Also return 2-3 image alt suggestions in image_alts.');
  }
  lines.push('Meta description: compelling, 140-155 characters, contains the focus keyword.');

  // Human-quality / E-E-A-T guidelines so content reads as genuinely human.
  if (cfg.getBool('humanize')) {
    lines.push('Write like an experienced human practitioner, not an AI: vary sentence length and rhythm, avoid formulaic "In conclusion / In today\'s world" filler and repetitive phrasing.');
    if (cfg.getBool('human_examples')) lines.push('Include concrete worked examples, original analogies, and step-by-step reasoning a real expert would give. Add specific numbers, edge cases and "common mistakes".');
    if (cfg.getBool('human_first_person')) lines.push('Where natural, use light first-hand framing ("in practice", "a mistake I often see", "here\'s the quickest way") to signal real experience (E-E-A-T) — without fabricating credentials.');
    lines.push('Demonstrate expertise and trustworthiness: be accurate, cite/refer to authoritative sources, and only state what is true. Prefer clarity over fluff.');
    const author = cfg.get('author_name');
    if (author) lines.push(`Write in the voice of ${author}${cfg.get('author_bio') ? ` (${cfg.get('author_bio')})` : ''}.`);
  }
  if (cfg.getBool('use_latex')) lines.push('Format ALL mathematical expressions as LaTeX: inline math wrapped in single $...$ and display/standalone equations in $$...$$ (e.g. $$A^{-1} = \\frac{1}{\\det(A)}\\,\\text{adj}(A)$$). Use proper LaTeX commands (\\frac, \\sum, \\int, \\mathbf, matrices via \\begin{bmatrix}…\\end{bmatrix}).');
  // The owner's own rules always win — appended last so they take priority.
  const custom = cfg.get('content_instructions');
  if (custom && custom.trim()) lines.push(`OWNER'S RULES (must follow exactly): ${custom.trim()}`);
  return lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

// Output format: a small JSON METADATA block + a RAW CONTENT block. Keeping the
// article body OUTSIDE of JSON is what makes LaTeX/HTML (backslashes & quotes)
// safe — embedding "\frac" or class="x" inside a JSON string breaks parsing.
export const OUTPUT_SPEC = `Respond in EXACTLY this two-block format — a JSON metadata block, then a raw content block:

<<<META
{"title":"SEO title 50-60 chars, contains focus keyword (+ number/power word)","slug":"short-url-slug-with-keyword","focus_keyword":"the single primary keyword","meta_description":"140-155 chars, contains focus keyword","excerpt":"1-2 sentence excerpt","tags":["3-6","relevant","tags"],"image_alts":["keyword-rich alt text 1","alt 2"],"faq":[{"q":"question","a":"plain-text answer (no LaTeX/HTML)"}]}
META>>>
<<<CONTENT
(full WordPress Gutenberg block markup body here: TOC, key takeaways, H2/H3 sections, lists, internal+external links, FAQ. Write HTML and LaTeX normally — do NOT escape backslashes or quotes.)
CONTENT>>>

RULES: the META block must be VALID JSON containing NO HTML/LaTeX (keep it on one line if you can). Put ALL article body, HTML and LaTeX ONLY inside the CONTENT block, raw and unescaped.`;

// Rich PRESENTATION kit — ready-made styled components (wp:html blocks with
// INLINE styles, so they render identically on ANY WordPress theme once
// published) accented with the active theme's primary colour. Injected into the
// generation prompt so every article reads like a polished magazine piece.
export function presentationKit(pri = '#2563eb') {
  const style = (cfg.get('presentation_style') || 'rich').toLowerCase();
  const guide = style === 'minimal'
    ? 'Use 3–4 of these components, sparingly — keep it clean.'
    : style === 'standard'
      ? 'Use 5–7 of these components where they genuinely help the reader.'
      : 'Use a RICH variety (8–11 different component types) for a polished, magazine-quality layout — vary them so no two adjacent sections look the same.';
  return `
PRESENTATION — make the article visually engaging so readers love it and stay. ${guide} Each is a wp:html block with inline styles — copy the structure, fill with REAL on-brand copy, never placeholders. Accent colour = ${pri}. Weave them naturally through the piece (don't pile them up); keep TL;DR / Quick Answer / Key Takeaways near the top.

• TL;DR SUMMARY (very top — one sentence summing up the whole article):
<!-- wp:html --><div style="background:${pri}0d;border-left:4px solid ${pri};border-radius:8px;padding:12px 16px;margin:16px 0;font-size:15px"><strong style="color:${pri}">⚡ TL;DR:</strong> …</div><!-- /wp:html -->

• QUICK ANSWER (right after the intro — a direct 2–3 sentence answer, great for featured snippets):
<!-- wp:html --><div style="background:#f4f8ff;border:1px solid ${pri};border-left:5px solid ${pri};border-radius:10px;padding:16px 20px;margin:20px 0"><strong style="color:${pri}">✅ Quick answer:</strong> …</div><!-- /wp:html -->

• KEY TAKEAWAYS (near the top — 3–5 punchy bullets):
<!-- wp:html --><div style="background:#f8fafc;border-left:4px solid ${pri};border-radius:10px;padding:18px 22px;margin:22px 0"><p style="margin:0 0 10px;font-weight:700;color:${pri};font-size:15px">🔑 Key Takeaways</p><ul style="margin:0;padding-left:20px;line-height:1.9"><li>…</li></ul></div><!-- /wp:html -->

• PRO TIP / TRICK (sprinkle 2–3 through the body):
<!-- wp:html --><div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px 18px;margin:18px 0"><strong>💡 Pro tip:</strong> …</div><!-- /wp:html -->

• COMMON MISTAKE / WARNING:
<!-- wp:html --><div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;margin:18px 0"><strong>⚠️ Avoid this:</strong> …</div><!-- /wp:html -->

• PULL QUOTE (one memorable line):
<!-- wp:html --><blockquote style="border-left:5px solid ${pri};margin:24px 0;padding:6px 22px;font-size:1.25em;font-style:italic;color:#374151">“…”</blockquote><!-- /wp:html -->

• STAT / HIGHLIGHT CARDS (when you cite numbers — a row of cards):
<!-- wp:html --><div style="display:flex;gap:14px;flex-wrap:wrap;margin:20px 0"><div style="flex:1;min-width:140px;background:#f8fafc;border:1px solid #e5e7eb;border-top:3px solid ${pri};border-radius:10px;padding:16px;text-align:center"><div style="font-size:26px;font-weight:800;color:${pri}">90%</div><div style="font-size:13px;color:#6b7280">what it means</div></div></div><!-- /wp:html -->

• STEP CARDS (for how-to steps — numbered):
<!-- wp:html --><div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;margin:14px 0;display:flex;gap:14px;align-items:flex-start"><div style="flex:0 0 30px;height:30px;background:${pri};color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700">1</div><div><strong>Step title</strong><br>…</div></div><!-- /wp:html -->

• AT-A-GLANCE COMPARISON TABLE (when comparing options/methods/types — readers love these):
<!-- wp:html --><div style="overflow-x:auto;margin:22px 0"><table style="width:100%;border-collapse:collapse;font-size:15px"><thead><tr style="background:${pri};color:#fff"><th style="padding:10px 14px;text-align:left">Option</th><th style="padding:10px 14px;text-align:left">Best for</th><th style="padding:10px 14px;text-align:left">Watch out for</th></tr></thead><tbody><tr style="border-bottom:1px solid #e5e7eb"><td style="padding:10px 14px"><strong>…</strong></td><td style="padding:10px 14px">…</td><td style="padding:10px 14px">…</td></tr></tbody></table></div><!-- /wp:html -->

• CHECKLIST (actionable summary the reader can follow):
<!-- wp:html --><div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 20px;margin:20px 0"><p style="margin:0 0 8px;font-weight:700">✔️ Quick checklist</p><ul style="list-style:none;margin:0;padding:0;line-height:2"><li>☑️ …</li><li>☑️ …</li></ul></div><!-- /wp:html -->

• "DID YOU KNOW?" FACT BOX (a surprising, true fact to keep them reading):
<!-- wp:html --><div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin:18px 0"><strong>🤔 Did you know?</strong> …</div><!-- /wp:html -->

• EXPERT-STYLE INSIGHT (first-hand practitioner note, builds E-E-A-T):
<!-- wp:html --><div style="background:#f5f3ff;border-left:4px solid ${pri};border-radius:10px;padding:14px 18px;margin:18px 0"><strong>🎯 From experience:</strong> …</div><!-- /wp:html -->

• INFO / NOTE (neutral informational aside — distinct from a tip):
<!-- wp:html --><div style="background:#eff6ff;border:1px solid #bfdbfe;border-left:4px solid #3b82f6;border-radius:10px;padding:14px 18px;margin:18px 0"><strong style="color:#1d4ed8">ℹ️ Note:</strong> …</div><!-- /wp:html -->

• IMPORTANT / HIGHLIGHT (amber — something the reader must not miss):
<!-- wp:html --><div style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f59e0b;border-radius:10px;padding:14px 18px;margin:18px 0"><strong style="color:#b45309">⭐ Important:</strong> …</div><!-- /wp:html -->

• DEFINITION BOX (define a key term/jargon in plain English):
<!-- wp:html --><div style="background:#f8fafc;border:1px dashed ${pri};border-radius:10px;padding:14px 18px;margin:18px 0"><strong style="color:${pri}">📖 Definition — Term:</strong> a clear, plain-English definition.</div><!-- /wp:html -->

• PROS & CONS (two columns — great for comparisons/decisions):
<!-- wp:html --><div style="display:flex;gap:14px;flex-wrap:wrap;margin:20px 0"><div style="flex:1;min-width:200px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px 18px"><p style="margin:0 0 8px;font-weight:700;color:#047857">✅ Pros</p><ul style="margin:0;padding-left:18px;line-height:1.9"><li>…</li></ul></div><div style="flex:1;min-width:200px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px"><p style="margin:0 0 8px;font-weight:700;color:#b91c1c">❌ Cons</p><ul style="margin:0;padding-left:18px;line-height:1.9"><li>…</li></ul></div></div><!-- /wp:html -->

• WORKED EXAMPLE (show a concrete example with real numbers/steps):
<!-- wp:html --><div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:16px 20px;margin:20px 0"><p style="margin:0 0 8px;font-weight:700;color:#6d28d9">🧪 Worked example</p><div style="font-size:15px">…</div></div><!-- /wp:html -->

• RELATED READING CARD (near the end — put 2–3 of the REAL internal-link URLs here, AND also weave 2–3 of those links inline within sentences where contextually relevant):
<!-- wp:html --><div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:18px 22px;margin:26px 0"><p style="margin:0 0 10px;font-weight:700">📚 Keep reading</p><ul style="margin:0;padding-left:20px;line-height:2"><li><a href="REAL_INTERNAL_URL" style="color:${pri}">descriptive anchor</a></li></ul></div><!-- /wp:html -->

• CLOSING CTA BAND (end the article with a clear next step):
<!-- wp:html --><div style="background:linear-gradient(135deg,${pri},#1f2937);color:#fff;border-radius:14px;padding:24px 26px;margin:28px 0;text-align:center"><p style="margin:0 0 6px;font-size:18px;font-weight:800">Ready to go further?</p><p style="margin:0 0 14px;opacity:.92">One-line encouragement tied to the topic.</p><a href="REAL_INTERNAL_URL" style="display:inline-block;background:#fff;color:${pri};padding:11px 22px;border-radius:8px;font-weight:700;text-decoration:none">Next step →</a></div><!-- /wp:html -->

• FAQ — keep each question as an H3 (for FAQ schema) with a concise answer; you may wrap the section in a light card.

GOAL: a varied, scannable, magazine-quality layout — real copy in every component, strategic internal links (inline + the related card), short paragraphs, and clear visual rhythm. Do not output empty or placeholder components.`;
}

// Words Rank Math treats as carrying positive/negative title sentiment.
export const SENTIMENT_WORDS = [
  'best', 'worst', 'amazing', 'incredible', 'essential', 'ultimate', 'easy', 'simple',
  'powerful', 'proven', 'avoid', 'mistakes', 'stop', 'never', 'always', 'fast', 'free',
  'huge', 'massive', 'surprising', 'shocking', 'painful', 'effortless', 'guaranteed', 'top',
];

// Faithful re-implementation of Rank Math's on-page analysis: the SAME tests, the
// SAME four groups, and WEIGHTED scoring (not a naïve pass-count) so our number
// tracks Rank Math's. Content length is tiered like Rank Math; a missing internal
// link / subheading keyword / density / image-alt cost real points — matching the
// "74/100" you see in the plugin. Returns { score, checks:[{group,label,pass,weight}] }.
// Pass `kwUsedBefore:true` if the focus keyword was already used on another post.
export function score({ title = '', slug = '', content = '', metaDescription = '', focusKeyword = '', kwUsedBefore = false } = {}) {
  // Normalise so "&" and "and" (and extra spaces) match — Rank Math treats them as equal.
  const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  const kw = String(focusKeyword).toLowerCase().trim();
  const kwN = norm(kw);
  const kwEsc = kwN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const kwSlug = kwN.replace(/\s+/g, '-');
  const bodyText = stripHtml(content).toLowerCase();
  const bodyN = norm(bodyText);
  const words = bodyText.split(/\s+/).filter(Boolean);
  const headings = [...content.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => norm(stripHtml(m[1])));
  const anchorTags = [...content.matchAll(/<a\s[^>]*>/gi)].map((m) => m[0]);
  const hrefs = anchorTags.map((t) => (t.match(/href=["']([^"']+)["']/i) || [])[1] || '');
  // Same-domain full URLs count as INTERNAL (not external).
  let siteHost = '';
  try { siteHost = new URL(cfg.get('wp_base_url')).host.replace(/^www\./, ''); } catch { siteHost = ''; }
  const isInternal = (h) => h && (h.startsWith('#') || h.startsWith('/') || (siteHost && h.includes(siteHost)) || !/^https?:\/\//i.test(h));
  const internal = hrefs.filter(isInternal);
  const external = anchorTags.filter((t, i) => /^https?:\/\//i.test(hrefs[i]) && !isInternal(hrefs[i]));
  const externalDofollow = external.filter((t) => !/rel=["'][^"']*nofollow/i.test(t));
  const imgAlts = [...content.matchAll(/<img[^>]*alt=["']([^"']*)["']/gi)].map((m) => norm(m[1]));
  const kwCount = kwN ? (bodyN.match(new RegExp(kwEsc, 'g')) || []).length : 0;
  const density = words.length ? (kwCount / words.length) * 100 : 0;
  // Owner-configurable acceptable density band (over the max = stuffing → fails).
  const densMin = parseFloat(cfg.get('seo_density_min')) || 1.0;
  const densMax = parseFloat(cfg.get('seo_density_max')) || 1.5;
  const titleN = norm(title);
  const firstWords = titleN.split(/\s+/).slice(0, 4).join(' ');

  // Content length tiered like Rank Math (fraction of full marks).
  const w = words.length;
  const lengthFrac = w >= 2500 ? 1 : w >= 2000 ? 0.9 : w >= 1500 ? 0.8 : w >= 1000 ? 0.6 : w >= 600 ? 0.4 : (w / 600) * 0.3;

  // [group, label, pass(boolean), weight, fraction(optional 0-1 overrides pass)]
  const metaN = norm(metaDescription);
  const T = [
    ['Basic SEO', 'Focus Keyword in the SEO title', !!kwN && titleN.includes(kwN), 5],
    ['Basic SEO', 'Focus Keyword in the meta description', !!kwN && metaN.includes(kwN), 4],
    ['Basic SEO', 'Focus Keyword in the URL', !!kwN && norm(slug.replace(/-/g, ' ')).includes(kwN), 4],
    ['Basic SEO', 'Focus Keyword in first 10% of content', !!kwN && bodyN.slice(0, Math.max(150, Math.floor(bodyN.length * 0.1))).includes(kwN), 4],
    ['Basic SEO', 'Focus Keyword in the content', kwCount > 0, 3],
    ['Basic SEO', `Content is ${w} words long`, w >= 600, 8, lengthFrac],
    ['Additional', 'Focus Keyword in subheading(s)', !!kwN && headings.some((h) => h.includes(kwN)), 5],
    ['Additional', 'Image with Focus Keyword as alt text', !!kwN && imgAlts.some((a) => a.includes(kwN)), 4],
    ['Additional', `Keyword Density ${density.toFixed(2)}% (target ${densMin}–${densMax}%)`, density >= densMin && density <= densMax, 5],
    ['Additional', `URL is ${slug.length} characters long`, slug.length > 0 && slug.length <= 75, 2],
    ['Additional', 'Links to external resources', external.length > 0, 3],
    ['Additional', 'External link with DoFollow', externalDofollow.length > 0, 2],
    ['Additional', 'Internal links in content', internal.length > 0, 6],
    ['Additional', "Focus Keyword not used before", !kwUsedBefore, 2],
    ['Title Readability', 'Focus Keyword at the beginning of the title', !!kwN && firstWords.includes(kwN.split(/\s+/)[0]), 3],
    ['Title Readability', 'Title has a positive/negative sentiment', SENTIMENT_WORDS.some((s) => titleN.includes(s)), 2],
    ['Title Readability', 'Title contains a power word', POWER_WORDS.some((p) => titleN.includes(p)), 2],
    ['Title Readability', 'Number in the title', /\d/.test(title), 2],
    ['Content Readability', 'Table of Contents', /table of contents/i.test(content) || /<!--\s*wp:rank-math\/toc/i.test(content), 3],
    ['Content Readability', 'Short paragraphs', shortParagraphs(content), 3],
    ['Content Readability', 'Content has images / videos', /<img|<video|wp:embed|wp:video|youtube|vimeo/i.test(content), 3],
  ];

  const checks = T.map(([group, label, pass, weight, frac]) => ({ group, label, pass: frac != null ? frac >= 0.5 : !!pass, weight, frac: frac != null ? frac : (pass ? 1 : 0) }));
  const totalWeight = checks.reduce((a, c) => a + c.weight, 0);
  const earned = checks.reduce((a, c) => a + c.weight * c.frac, 0);
  const scoreVal = Math.round((earned / totalWeight) * 100);
  return {
    score: scoreVal, checks,
    passed: checks.filter((c) => c.pass).length, total: checks.length,
    density: +density.toFixed(2), words: w, kwCount,
    internal: internal.length, external: external.length,
  };
}

// Heuristic for Rank Math's "short paragraphs" test (no paragraph > ~120 words).
function shortParagraphs(content) {
  const paras = [...content.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => stripHtml(m[1]));
  if (!paras.length) return true;
  return !paras.some((p) => p.split(/\s+/).filter(Boolean).length > 120);
}

export default { requirements, presentationKit, score, OUTPUT_SPEC, POWER_WORDS, SENTIMENT_WORDS };
