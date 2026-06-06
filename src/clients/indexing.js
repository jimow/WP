// Google Indexing API client — pings Google to (re)crawl a URL the moment we
// publish or update it, so fresh content gets discovered fast instead of waiting
// for the next organic crawl. Uses a Google service account (JWT / RS256), no SDK.
//
// One-time setup the owner does (surfaced in Settings):
//   1. Google Cloud → enable "Indexing API".
//   2. Create a Service Account → add a JSON key → paste the whole JSON into
//      Settings → "Indexing API service account".
//   3. In Search Console → Settings → Users and permissions → add the service
//      account's client_email as an OWNER of the property.
import crypto from 'node:crypto';
import cfg from '../config.js';

let cached = { token: null, exp: 0 };

function serviceAccount() {
  const raw = (cfg.get('indexing_service_account') || '').trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (sa.client_email && sa.private_key) return sa;
  } catch { /* invalid JSON */ }
  return null;
}

export function configured() {
  return !!serviceAccount();
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Build + sign a JWT, then exchange it for an access token (jwt-bearer grant).
async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const sa = serviceAccount();
  if (!sa) throw new Error('Indexing API service account not set (Settings → Indexing).');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/indexing',
    aud: 'https://oauth2.googleapis.com/token',
    iat, exp,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claim}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Indexing auth failed: ${data.error_description || data.error || res.status}`);
  cached = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

// Notify Google a URL was updated (default) or deleted.
export async function publishUrl(url, type = 'URL_UPDATED') {
  const token = await accessToken();
  const res = await fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url, type }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Indexing publish failed: ${data.error?.message || res.status}`);
  return data;
}

export default { configured, publishUrl };
