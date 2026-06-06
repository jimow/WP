// SQLite persistence layer (better-sqlite3, synchronous).
//
// MULTI-TENANCY MODEL
// -------------------
// There are two kinds of data:
//   • SHARED   — users, global settings, per-tenant settings overrides. These
//                live ONLY in the main file (autopilot.db) and are reached via
//                the exported `shared` connection.
//   • CONTENT  — keywords, clusters, articles, pages, jobs, logs, optimizations,
//                rank/index tracking, etc. These are PER-WORKSPACE: each tenant
//                gets its OWN database file so one owner can NEVER see another's
//                articles/keywords. Reached via the default export (a proxy that
//                resolves the current request's workspace).
//
// The super-admin's workspace id is 'admin' and its content lives in the SAME
// autopilot.db that already holds all existing data — so upgrading is a no-op
// (no data migration). Every other workspace gets data/ws/<id>.db on first use.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import tenancy from './tenancy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const wsDir = path.join(dataDir, 'ws');
fs.mkdirSync(wsDir, { recursive: true });

// --- Shared (cross-tenant) tables: users + settings ------------------------
// These exist only on the main connection.
const SHARED_SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Users (local auth). The FIRST registered user is the super_admin and owns the
-- existing/global settings. Each user owns a workspace (tenant).
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'owner',   -- super_admin | owner
  workspace_id  TEXT UNIQUE NOT NULL,            -- this user's tenant id
  reset_token   TEXT,                            -- sha256 of the reset token
  reset_expires TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  last_login    TEXT
);

-- Per-tenant settings overrides. Global settings live in the settings table;
-- per-tenant keys (WordPress, GSC, brand, automation) live here keyed by
-- workspace. Shared keys (AI providers, Ahrefs) are NOT stored here.
CREATE TABLE IF NOT EXISTS tenant_settings (
  workspace_id TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        TEXT,
  PRIMARY KEY (workspace_id, key)
);
`;

// --- Per-workspace (content) tables ----------------------------------------
const CONTENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS keywords (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword      TEXT NOT NULL,
  volume       INTEGER,
  difficulty   INTEGER,
  cpc          REAL,
  intent       TEXT,
  parent_topic TEXT,
  source       TEXT DEFAULT 'ahrefs',     -- ahrefs | manual
  status       TEXT DEFAULT 'new',        -- new | clustered | ignored
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE(keyword)
);

CREATE TABLE IF NOT EXISTS clusters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  hub_keyword TEXT NOT NULL,
  intent      TEXT,
  status      TEXT DEFAULT 'planned',     -- planned | active | done
  wp_page_id  INTEGER,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cluster_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  keyword    TEXT NOT NULL,
  role       TEXT DEFAULT 'spoke',        -- hub | spoke
  article_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cluster_id       INTEGER REFERENCES clusters(id) ON DELETE SET NULL,
  keyword          TEXT NOT NULL,
  title            TEXT,
  slug             TEXT,
  content          TEXT,
  excerpt          TEXT,
  meta_description TEXT,
  role             TEXT DEFAULT 'spoke',
  status           TEXT DEFAULT 'idea',
  wp_post_id       INTEGER,
  wp_url           TEXT,
  scheduled_for    TEXT,
  error            TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  slug       TEXT,
  kind       TEXT DEFAULT 'standard',
  content    TEXT,
  status     TEXT DEFAULT 'pending_review',
  wp_page_id INTEGER,
  wp_url     TEXT,
  error      TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  payload     TEXT,
  status      TEXT DEFAULT 'queued',
  run_at      TEXT DEFAULT (datetime('now')),
  attempts    INTEGER DEFAULT 0,
  result      TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  summary     TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  level      TEXT DEFAULT 'info',
  area       TEXT,
  message    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS keyword_index (
  norm      TEXT PRIMARY KEY,
  keyword   TEXT,
  url       TEXT,
  source    TEXT,
  built_at  TEXT
);

CREATE TABLE IF NOT EXISTS optimizations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  target_url  TEXT,
  query       TEXT,
  post_id     INTEGER,
  post_type   TEXT,
  metrics     TEXT,
  before      TEXT,
  after       TEXT,
  gain        INTEGER,
  status      TEXT DEFAULT 'suggested',
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  applied_at  TEXT
);

CREATE TABLE IF NOT EXISTS rank_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  url         TEXT NOT NULL,
  position    REAL,
  impressions INTEGER,
  clicks      INTEGER,
  ctr         REAL,
  captured_at TEXT DEFAULT (datetime('now')),
  UNIQUE(date, url)
);

CREATE TABLE IF NOT EXISTS index_status (
  url          TEXT PRIMARY KEY,
  verdict      TEXT,
  coverage     TEXT,
  last_crawl   TEXT,
  submitted_at TEXT,
  checked_at   TEXT
);

-- Persisted post/article intelligence (SERP content-gap analysis) so results
-- survive navigation. Keyed by target_ref (article:<id> or a live URL); the
-- latest analysis REPLACES the previous one.
CREATE TABLE IF NOT EXISTS post_analyses (
  target_ref  TEXT PRIMARY KEY,   -- 'article:<id>' | the live post URL
  target_kind TEXT,               -- article | post | page
  keyword     TEXT,
  result      TEXT,               -- JSON analysis payload
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, run_at);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_opt_status ON optimizations(status);
CREATE INDEX IF NOT EXISTS idx_rank_url ON rank_snapshots(url, date);
`;

function addColumn(conn, table, col, def) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

// Apply the content schema + idempotent migrations + orphan recovery to a
// connection. Run for the main DB and for every per-workspace DB on open.
function initContent(conn) {
  conn.exec(CONTENT_SCHEMA);
  // Migrations (idempotent).
  addColumn(conn, 'articles', 'published_at', 'TEXT');
  addColumn(conn, 'pages', 'published_at', 'TEXT');
  addColumn(conn, 'articles', 'focus_keyword', 'TEXT');
  addColumn(conn, 'articles', 'seo_score', 'INTEGER');
  addColumn(conn, 'articles', 'tags', 'TEXT');
  addColumn(conn, 'articles', 'faq', 'TEXT');
  addColumn(conn, 'articles', 'image_alts', 'TEXT');
  addColumn(conn, 'articles', 'kw_warning', 'TEXT');
  addColumn(conn, 'pages', 'meta_description', 'TEXT'); // used by tool/calculator pages
  // Recover orphaned in-flight work on startup: 'generating'/'publishing' only
  // exist while a request runs, so leftovers mean the process was interrupted.
  conn.exec(`
    UPDATE articles SET status = CASE WHEN content IS NOT NULL AND trim(content) != '' THEN 'pending_review' ELSE 'idea' END,
      error = COALESCE(error, 'Previous generation was interrupted — regenerate to retry')
      WHERE status = 'generating';
    UPDATE articles SET status = 'approved' WHERE status = 'publishing';
  `);
}

function openConn(file) {
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  return conn;
}

// Main DB = shared tables + the super-admin ('admin') workspace content.
const main = openConn(path.join(dataDir, 'autopilot.db'));
main.exec(SHARED_SCHEMA);
initContent(main);

// --- Workspace connection routing ------------------------------------------
const conns = new Map([['admin', main]]);
function safeWs(ws) { return String(ws || 'admin').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'admin'; }
function openWorkspace(ws) {
  ws = safeWs(ws);
  if (conns.has(ws)) return conns.get(ws);
  const conn = openConn(path.join(wsDir, `${ws}.db`));
  initContent(conn);
  conns.set(ws, conn);
  return conn;
}
function currentWs() {
  const ctx = tenancy.current();
  return ctx && ctx.workspaceId ? ctx.workspaceId : 'admin';
}
function activeConn() { return openWorkspace(currentWs()); }

// --- Context-aware proxy ----------------------------------------------------
// Statements are bound to a specific connection, but our code prepares many at
// module-load time (before any request context exists). So `prepare()` returns
// a LAZY wrapper that resolves the current workspace's connection on each call
// and caches the compiled statement per (workspace, sql).
const stmtCache = new Map();
function compiled(sql) {
  const ws = currentWs();
  const key = ws + ' ' + sql;
  let s = stmtCache.get(key);
  if (!s) { s = activeConn().prepare(sql); stmtCache.set(key, s); }
  return s;
}

// --- Change tracking (for Supabase-as-primary write-through mirroring) -------
// When sync is enabled, any mutation marks its workspace "dirty" so the sync
// service can push just the changed workspaces up to the cloud.
let syncOn = false;
const dirty = new Set();
const MUTATION = /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i;
function markIfMutation(sql) { if (syncOn && MUTATION.test(sql)) dirty.add(currentWs()); }
export function setSyncEnabled(v) { syncOn = !!v; }
export function drainDirty() { const a = [...dirty]; dirty.clear(); return a; }

function lazyStatement(sql) {
  return {
    run: (...a) => { const r = compiled(sql).run(...a); markIfMutation(sql); return r; },
    get: (...a) => compiled(sql).get(...a),
    all: (...a) => compiled(sql).all(...a),
    iterate: (...a) => compiled(sql).iterate(...a),
    pluck: (on) => compiled(sql).pluck(on),
    raw: (on) => compiled(sql).raw(on),
  };
}

const dbProxy = {
  prepare: (sql) => lazyStatement(sql),
  // better-sqlite3 transaction(fn) returns a function; wrap so the transaction
  // is created on the current workspace's connection at call time.
  transaction: (fn) => (...args) => activeConn().transaction(fn)(...args),
  exec: (sql) => { markIfMutation(sql); return activeConn().exec(sql); },
  pragma: (p, opts) => activeConn().pragma(p, opts),
  get inTransaction() { return activeConn().inTransaction; },
};

// Every workspace that has a local store: 'admin' (the main DB) plus each
// per-workspace file under data/ws. Used by the backup/sync layer so no tenant's
// data is missed even if its user row is gone.
export function workspaceIds() {
  const set = new Set(['admin']);
  try { for (const f of fs.readdirSync(wsDir)) if (f.endsWith('.db')) set.add(f.replace(/\.db$/, '')); } catch { /* dir may be empty */ }
  return [...set];
}

// `shared` = users + global/tenant settings (cross-tenant). Always the main DB.
export const shared = main;
// Default = workspace-scoped content proxy.
export default dbProxy;
