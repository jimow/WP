// Settings resolution. Order of precedence: dashboard (DB) value > .env > default.
// Secrets are stored in the DB so the user can manage everything from the GUI,
// but .env still works for headless/server deploys.
import 'dotenv/config';
import { shared as db } from './db.js'; // settings + tenant_settings are cross-tenant
import tenancy from './tenancy.js';
import { defaultsFromSchema, secretsFromSchema, envMap } from './settings-schema.js';

// Defaults come from the declarative schema; .env overrides apply for keys that
// declare an env var. This is the single place behavior defaults are resolved.
const DEFAULTS = defaultsFromSchema();
for (const [key, envName] of Object.entries(envMap())) {
  if (process.env[envName]) DEFAULTS[key] = process.env[envName];
}

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
const tGetStmt = db.prepare('SELECT value FROM tenant_settings WHERE workspace_id = ? AND key = ?');
const tSetStmt = db.prepare(
  'INSERT INTO tenant_settings(workspace_id, key, value) VALUES(?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value'
);

// GLOBAL read (the existing single-tenant behaviour): settings table → default.
function globalGet(key) {
  const row = getStmt.get(key);
  if (row && row.value !== null && row.value !== '') return row.value;
  if (DEFAULTS[key] !== undefined && DEFAULTS[key] !== '') return DEFAULTS[key];
  return row ? row.value : DEFAULTS[key];
}

export function get(key) {
  const ctx = tenancy.current();
  // Shared keys, no auth context, or the super-admin → use the global store.
  if (!ctx || ctx.isSuperAdmin || tenancy.isGlobalKey(key)) return globalGet(key);
  // Owner + per-tenant key → their workspace override, else the schema default
  // (so each owner connects their OWN WordPress/GSC and starts clean).
  const row = tGetStmt.get(ctx.workspaceId, key);
  if (row && row.value !== null && row.value !== '') return row.value;
  return DEFAULTS[key];
}

export function getBool(key) {
  return String(get(key)).toLowerCase() === 'true';
}

export function getInt(key, fallback = 0) {
  const n = parseInt(get(key), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function set(key, value) {
  const ctx = tenancy.current();
  const v = value == null ? '' : String(value);
  if (!ctx || ctx.isSuperAdmin || tenancy.isGlobalKey(key)) { setStmt.run(key, v); return; }
  tSetStmt.run(ctx.workspaceId, key, v);
}

export function all() {
  const out = { ...DEFAULTS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    out[row.key] = row.value;
  }
  // Layer this tenant's per-tenant overrides for an owner (not the super-admin,
  // who edits the global store directly).
  const ctx = tenancy.current();
  if (ctx && !ctx.isSuperAdmin) {
    // Per-tenant keys: start from defaults (owners don't inherit the admin's WP/GSC).
    for (const k of Object.keys(DEFAULTS)) if (!tenancy.isGlobalKey(k)) out[k] = DEFAULTS[k];
    for (const row of db.prepare('SELECT key, value FROM tenant_settings WHERE workspace_id = ?').all(ctx.workspaceId)) {
      out[row.key] = row.value;
    }
  }
  return out;
}

// Settings safe to send to the browser (secrets masked).
const SECRET_KEYS = new Set(secretsFromSchema());

export function publicAll() {
  const out = all();
  for (const k of SECRET_KEYS) {
    out[k] = out[k] ? '••••••••' + String(out[k]).slice(-4) : '';
  }
  return out;
}

export function isSecret(key) {
  return SECRET_KEYS.has(key);
}

export default { get, getBool, getInt, set, all, publicAll, isSecret, DEFAULTS };
