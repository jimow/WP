// Ahrefs API v3 client. Uses the bearer "API key" token.
// Docs: https://docs.ahrefs.com/docs/api  (endpoints under https://api.ahrefs.com/v3)
//
// We mainly use Keywords Explorer endpoints to expand a seed keyword into
// related ideas with volume / difficulty. The exact response shape can vary by
// plan, so we normalise defensively and degrade gracefully.
import cfg from '../config.js';
import log from '../log.js';

const BASE = 'https://api.ahrefs.com/v3';

function token() {
  const t = cfg.get('ahrefs_api_token');
  if (!t) throw new Error('Ahrefs API token is not set (Settings > Connections).');
  return t;
}

async function ahrefsFetch(pathname, query = {}) {
  const url = `${BASE}${pathname}?${new URLSearchParams(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data && data.error ? data.error : `${res.status} ${res.statusText}`;
    throw new Error(`Ahrefs ${pathname} failed: ${msg}`);
  }
  return data;
}

function normalizeRows(data) {
  // Ahrefs v3 typically returns { keywords: [...] } or { data: [...] }.
  const rows = data?.keywords || data?.data || data?.rows || [];
  return rows.map((r) => ({
    keyword: r.keyword || r.term || r.query,
    volume: r.volume ?? r.search_volume ?? r.volume_monthly ?? null,
    difficulty: r.difficulty ?? r.keyword_difficulty ?? r.kd ?? null,
    cpc: r.cpc ?? null,
    parent_topic: r.parent_topic || r.parent || null,
    intent: r.intent || (Array.isArray(r.intents) ? r.intents.join(',') : null),
  })).filter((r) => r.keyword);
}

export const ahrefs = {
  configured() {
    return !!cfg.get('ahrefs_api_token');
  },

  // Validate the token cheaply (subscription/limits endpoint).
  async ping() {
    return ahrefsFetch('/subscription-info/limits-and-usage', {});
  },

  // Expand a seed keyword into ideas. country = 2-letter code.
  async keywordIdeas(seed, country = 'us', limit = 50) {
    const params = {
      select: 'keyword,volume,difficulty,cpc,parent_topic',
      country,
      keywords: seed,
      limit: String(limit),
    };
    // "matching-terms" returns keywords containing the seed; widely available.
    try {
      const data = await ahrefsFetch('/keywords-explorer/matching-terms', params);
      const rows = normalizeRows(data);
      if (rows.length) return rows;
    } catch (e) {
      log.warn('ahrefs', `matching-terms failed, trying overview: ${e.message}`);
    }
    // Fallback: volume/difficulty for the exact seed(s).
    const data = await ahrefsFetch('/keywords-explorer/overview', {
      country, keywords: seed, select: 'keyword,volume,difficulty,cpc',
    });
    return normalizeRows(data);
  },
};

// --- Site Explorer (competitor & backlink intelligence) --------------------
// All of these hit Ahrefs Site Explorer v3. Endpoint names + response shapes
// vary by plan/version, so each tries a couple of paths and normalises
// defensively, degrading to an empty result (never throwing the whole UI down).
const today = () => new Date().toISOString().slice(0, 10);
const firstArray = (d) => (Array.isArray(d) ? d : (d?.refdomains || d?.domains || d?.backlinks || d?.keywords || d?.pages || d?.competitors || d?.metrics || d?.data || d?.rows || []));

async function tryPaths(paths, params) {
  for (const p of paths) {
    try { const d = await ahrefsFetch(p, params); if (d) return d; } catch { /* next */ }
  }
  return null;
}

// Try each path with several param/select variants (Ahrefs rejects unknown select
// fields with a 400) and return the first NON-EMPTY row array. This makes the
// list endpoints robust across plans/field-name differences.
async function seQuery(paths, variants) {
  for (const p of (Array.isArray(paths) ? paths : [paths])) {
    for (const params of variants) {
      try { const d = await ahrefsFetch(p, params); const rows = firstArray(d); if (rows.length) return rows; } catch { /* next */ }
    }
  }
  return [];
}

// Domain-level overview: Domain Rating + backlink/refdomain counts + organic
// traffic & keywords. Returns whatever the plan exposes (nulls where blocked).
ahrefs.domainOverview = async function domainOverview(target, country = 'us') {
  const t = String(target || '').trim();
  if (!t) throw new Error('Enter a domain or URL.');
  const out = { target: t, domainRating: null, ahrefsRank: null, backlinks: null, refDomains: null, orgTraffic: null, orgKeywords: null, orgCost: null };
  const dr = await tryPaths(['/site-explorer/domain-rating'], { target: t, date: today() });
  const drRow = dr?.domain_rating || dr?.domainRating || (Array.isArray(dr?.metrics) ? dr.metrics[0] : dr);
  if (drRow) { out.domainRating = drRow.domain_rating ?? drRow.dr ?? null; out.ahrefsRank = drRow.ahrefs_rank ?? null; }
  const stats = await tryPaths(['/site-explorer/backlinks-stats'], { target: t, date: today(), mode: 'subdomains' });
  const s = stats?.metrics || stats;
  if (s) { out.backlinks = s.live ?? s.all_time ?? s.backlinks ?? null; out.refDomains = s.live_refdomains ?? s.refdomains ?? null; }
  const m = await tryPaths(['/site-explorer/metrics'], { target: t, date: today(), country, mode: 'subdomains', volume_mode: 'monthly' });
  const mr = m?.metrics || m;
  if (mr) { out.orgTraffic = mr.org_traffic ?? mr.organic_traffic ?? null; out.orgKeywords = mr.org_keywords ?? mr.organic_keywords ?? null; out.orgCost = mr.org_cost ?? null; }
  return out;
};

// Backlinks pointing at a target (newest first). For link-building + auditing.
ahrefs.backlinks = async function backlinks(target, limit = 30) {
  const base = { target, mode: 'subdomains', limit: String(limit), history: 'live', aggregation: 'similar_links' };
  const rows = await seQuery(['/site-explorer/all-backlinks'], [
    { ...base, select: 'url_from,url_to,anchor,domain_rating_source,first_seen,link_type,is_dofollow' },
    { ...base, select: 'url_from,url_to,anchor,domain_rating_source,first_seen' },
    { target, mode: 'subdomains', limit: String(limit), select: 'url_from,anchor,domain_rating_source,first_seen' },
    { target, mode: 'subdomains', limit: String(limit) },
  ]);
  return rows.map((r) => ({
    fromUrl: r.url_from || r.urlFrom, toUrl: r.url_to || r.urlTo, anchor: r.anchor || '',
    dr: r.domain_rating_source ?? r.dr_source ?? null, traffic: r.traffic_domain ?? r.traffic ?? null,
    firstSeen: r.first_seen || r.firstSeen || null,
    nofollow: r.is_dofollow === false || r.nofollow === true || /nofollow/i.test(r.link_type || ''),
  })).filter((r) => r.fromUrl);
};

// Referring domains linking to a target (by strength). For outreach prospecting.
ahrefs.refDomains = async function refDomains(target, limit = 30) {
  // Ahrefs refdomains columns: domain, domain_rating, dofollow_links,
  // links_to_target, first_seen, traffic_domain (NOT "refdomain").
  const base = { target, mode: 'subdomains', limit: String(limit) };
  const rows = await seQuery(['/site-explorer/refdomains'], [
    { ...base, order_by: 'domain_rating:desc', select: 'domain,domain_rating,dofollow_links,links_to_target,first_seen,traffic_domain' },
    { ...base, select: 'domain,domain_rating,links_to_target,first_seen' },
    { ...base, select: 'domain,domain_rating' },
  ]);
  return rows.map((r) => ({
    domain: r.refdomain || r.domain, dr: r.domain_rating ?? r.dr ?? null,
    linkedPages: r.links_to_target ?? r.linked_pages ?? null,
    dofollow: r.dofollow_links ?? null, traffic: r.traffic_domain ?? null,
    firstSeen: r.first_seen || null,
  })).filter((r) => r.domain);
};

// Keywords a domain/URL already ranks for organically (their winning terms).
ahrefs.organicKeywords = async function organicKeywords(target, country = 'us', limit = 40) {
  const d = await tryPaths(['/site-explorer/organic-keywords'], {
    target, country, date: today(), mode: 'subdomains', limit: String(limit), order_by: 'sum_traffic:desc',
    select: 'keyword,volume,keyword_difficulty,best_position,sum_traffic,best_position_url',
  });
  return firstArray(d).map((r) => ({
    keyword: r.keyword, volume: r.volume ?? null, difficulty: r.keyword_difficulty ?? r.kd ?? null,
    position: r.best_position ?? r.position ?? null, traffic: r.sum_traffic ?? r.traffic ?? null,
    url: r.best_position_url || r.url || null,
  })).filter((r) => r.keyword);
};

// Top pages of a domain by organic traffic (their best content).
ahrefs.topPages = async function topPages(target, country = 'us', limit = 25) {
  const d = await tryPaths(['/site-explorer/top-pages'], {
    target, country, date: today(), mode: 'subdomains', limit: String(limit), order_by: 'sum_traffic:desc',
    select: 'url,sum_traffic,keywords,top_keyword,top_keyword_volume',
  });
  return firstArray(d).map((r) => ({
    url: r.url, traffic: r.sum_traffic ?? r.traffic ?? null, keywords: r.keywords ?? null,
    topKeyword: r.top_keyword || null, topKeywordVolume: r.top_keyword_volume ?? null,
  })).filter((r) => r.url);
};

// Top-ranking pages (SERP overview) for a keyword — used for competitor gap
// analysis. Endpoint/shape varies by plan, so we normalise defensively.
ahrefs.serpOverview = async function serpOverview(keyword, country = 'us', limit = 10) {
  const params = { country, keyword, select: 'url,title,position,domain_rating,backlinks,traffic', limit: String(limit) };
  for (const path of ['/serp-overview/serp-overview', '/serp-overview']) {
    try {
      const data = await ahrefsFetch(path, params);
      const rows = data?.positions || data?.pages || data?.data || data?.rows || [];
      const norm = rows.map((r) => ({
        url: r.url || r.page || r.target,
        title: r.title || r.page_title || '',
        position: r.position ?? r.pos ?? null,
        dr: r.domain_rating ?? r.dr ?? null,
        backlinks: r.backlinks ?? null,
        traffic: r.traffic ?? null,
      })).filter((r) => r.url);
      if (norm.length) return norm;
    } catch { /* try next */ }
  }
  return [];
};

export default ahrefs;
