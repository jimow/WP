// Entry point: serves the dashboard + API and starts the 24/7 scheduler.
import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import api from './routes/api.js';
import scheduler from './scheduler.js';
import { buildZip } from './services/zip.js';
import auth from './auth.js';
import tenancy from './tenancy.js';
import sync from './services/sync.js';
import log from './log.js';

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4317;
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';

app.use(express.json({ limit: '20mb' })); // accommodates base64 design uploads

// Optional very-light auth: a shared password via x-access header or ?key=.
if (PASSWORD) {
  app.use('/api', (req, res, next) => {
    // Google's OAuth redirect can't carry our access key — let the callback through.
    if (req.path === '/gsc/callback') return next();
    const key = req.get('x-access') || req.query.key;
    if (key === PASSWORD) return next();
    res.status(401).json({ error: 'unauthorized' });
  });
}

// --- Authentication gate + per-request tenant context ----------------------
// Identify the user from the session cookie, block protected API routes when the
// gate is active, and run the request inside the user's tenancy context so
// config.js resolves per-tenant (WordPress/GSC) vs shared (AI/Ahrefs) settings.
app.use('/api', (req, res, next) => {
  const token = parseCookies(req).wpap_session;
  req.user = token ? auth.userFromToken(token) : null;
  const open = req.path.startsWith('/auth/') || req.path === '/gsc/callback';
  if (auth.authActive() && !open && !req.user) {
    return res.status(401).json({ error: 'auth required', authRequired: true });
  }
  if (req.user) tenancy.run(auth.ctxFor(req.user), () => next());
  else next();
});

app.use('/api', api);

// Pre-build the SEO Bridge as an installable WordPress plugin zip and write it
// alongside the static assets so it's served by express.static — works even if
// the dynamic route below isn't reached. WordPress's "Plugins → Add New →
// Upload Plugin" expects a zip whose root holds one folder with the .php file
// inside, so we wrap it as wp-autopilot-seo/wp-autopilot-seo.php.
function buildBridgeZip() {
  try {
    const phpPath = path.join(__dirname, 'public', 'wp-autopilot-seo.php');
    const zipPath = path.join(__dirname, 'public', 'wp-autopilot-seo.zip');
    const php = fs.readFileSync(phpPath);
    const zip = buildZip([{ name: 'wp-autopilot-seo/wp-autopilot-seo.php', data: php }]);
    fs.writeFileSync(zipPath, zip);
    log.info('server', `Built SEO Bridge zip (${zip.length} bytes) → public/wp-autopilot-seo.zip`);
  } catch (e) {
    log.warn('server', `SEO Bridge zip build failed: ${e.message}`);
  }
}
buildBridgeZip();

// Dynamic route as a fallback (also rebuilds on demand so the zip can't go stale
// after the user updates the .php).
app.get('/wp-autopilot-seo.zip', (req, res, next) => {
  try {
    const php = fs.readFileSync(path.join(__dirname, 'public', 'wp-autopilot-seo.php'));
    const zip = buildZip([{ name: 'wp-autopilot-seo/wp-autopilot-seo.php', data: php }]);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="wp-autopilot-seo.zip"');
    res.setHeader('Content-Length', zip.length);
    res.end(zip);
  } catch (e) {
    next(e);
  }
});

// index:false so "/" does NOT auto-serve index.html — it must pass through the
// gate below. Other static assets (marketing pages, styles.css, app.js,
// login.html) still serve directly by their explicit paths.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
// Gate the app root. Unauthenticated visitors get the marketing landing page
// (which funnels them to register / sign in); authenticated users get the app.
// The marketing pages, login.html and assets remain public via express.static.
app.get('*', (req, res) => {
  if (auth.authActive()) {
    const token = parseCookies(req).wpap_session;
    if (!auth.userFromToken(token)) return res.sendFile(path.join(__dirname, 'public', 'landing.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Bind on IPv4 (0.0.0.0) so "localhost" resolves reliably across tools/browsers
// on Windows (some clients reach 127.0.0.1 which a bare IPv6 bind may not accept).
async function startup() {
  // If Supabase is the primary store, hydrate the local cache from the cloud
  // BEFORE serving or scheduling (cloud wins). No-op/skip otherwise.
  try { await sync.hydrateOnBoot(); }
  catch (e) { log.warn('server', `Supabase hydrate skipped: ${e.message}`); }

  app.listen(PORT, '0.0.0.0', () => {
    log.info('server', `WP Autopilot dashboard on http://localhost:${PORT}`);
    scheduler.start();
    sync.start(); // continuous write-through mirror (only active in primary mode)
  });
}
startup();
