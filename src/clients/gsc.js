// Google Search Console client. OAuth2 (installed-app flow) against a Google
// Cloud project the user creates, then the Search Analytics API. No SDK needed —
// plain fetch against Google's token + webmasters endpoints.
//
// Setup the user does once (we surface this in Settings):
//   1. console.cloud.google.com → new project → enable "Google Search Console API".
//   2. Credentials → OAuth client ID → type "Web application".
//   3. Authorised redirect URI:  http://localhost:4317/api/gsc/callback
//   4. Paste the Client ID + Secret into Settings, click "Connect Search Console".
import cfg from '../config.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
let cached = { token: null, exp: 0 };

export function configured() {
  return !!(cfg.get('gsc_client_id') && cfg.get('gsc_refresh_token'));
}

export function authUrl(redirectUri) {
  if (!cfg.get('gsc_client_id')) throw new Error('Set the Search Console Client ID in Settings first.');
  const p = new URLSearchParams({
    client_id: cfg.get('gsc_client_id'),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code, redirectUri) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.get('gsc_client_id'),
      client_secret: cfg.get('gsc_client_secret'),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token exchange failed: ${data.error_description || data.error}`);
  if (data.refresh_token) cfg.set('gsc_refresh_token', data.refresh_token);
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data;
}

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const refresh = cfg.get('gsc_refresh_token');
  if (!refresh) throw new Error('Search Console is not connected yet (Settings → Connect).');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.get('gsc_client_id'),
      client_secret: cfg.get('gsc_client_secret'),
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed: ${data.error_description || data.error}`);
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

export async function listSites() {
  const token = await accessToken();
  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Failed to list GSC sites');
  return data.siteEntry || [];
}

// Search Analytics query. dimensions e.g. ['query'], ['page'], ['date'].
export async function query({ startDate, endDate, dimensions = ['query'], rowLimit = 25, filters } = {}) {
  const token = await accessToken();
  const site = cfg.get('gsc_site_url');
  if (!site) throw new Error('Set your Search Console property URL in Settings.');
  const body = { startDate, endDate, dimensions, rowLimit };
  if (filters) body.dimensionFilterGroups = filters;
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Search Analytics query failed');
  return data.rows || [];
}

// Queries a specific page ranks for (uses a page=equals filter).
export async function queriesForPage(url, { startDate, endDate, rowLimit = 25 } = {}) {
  return query({
    startDate, endDate, dimensions: ['query'], rowLimit,
    filters: [{ filters: [{ dimension: 'page', operator: 'equals', expression: url }] }],
  });
}

// URL Inspection API — is a URL indexed? coverage state, last crawl, etc.
export async function inspectUrl(url) {
  const token = await accessToken();
  const site = cfg.get('gsc_site_url');
  if (!site) throw new Error('Set your Search Console property URL in Settings.');
  const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: url, siteUrl: site }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'URL inspection failed');
  const r = data.inspectionResult?.indexStatusResult || {};
  return {
    verdict: r.verdict,                 // PASS | NEUTRAL | FAIL
    coverageState: r.coverageState,     // e.g. "Submitted and indexed"
    robotsTxtState: r.robotsTxtState,
    indexingState: r.indexingState,
    lastCrawlTime: r.lastCrawlTime,
    googleCanonical: r.googleCanonical,
  };
}

export default { configured, authUrl, exchangeCode, listSites, query, queriesForPage, inspectUrl };
