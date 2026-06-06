// Cloud persistence — mirror the local SQLite data into Supabase so it survives
// machine loss and powers the multi-tenant SaaS. Uses a single generic JSONB
// table (backup_records) keyed by (workspace_id, table_name, record_id) so it
// NEVER drifts from the local schema.
//
// MULTI-TENANT: there are two kinds of data —
//   • SHARED tables (settings, users, tenant_settings) live in the main DB and
//     are mirrored once under the reserved workspace_id '_shared'.
//   • CONTENT tables (articles, clusters, …) are per-workspace; each tenant's
//     rows are read from THAT tenant's DB and tagged with its own workspace id.
// So every owner's data is backed up under their own workspace — not just admin.
import db, { shared, workspaceIds } from '../db.js';
import cfg from '../config.js';
import log from '../log.js';
import tenancy from '../tenancy.js';
import supabase from '../clients/supabase.js';

const SHARED_WS = '_shared';
const SHARED_TABLES = ['settings', 'users', 'tenant_settings'];
const CONTENT_TABLES = ['articles', 'clusters', 'cluster_items', 'pages', 'keywords', 'keyword_index', 'optimizations', 'rank_snapshots', 'index_status'];

// Stable per-row id for the backup key (tables differ in their natural key).
function recordId(table, r) {
  switch (table) {
    case 'settings': return String(r.key);
    case 'tenant_settings': return `${r.workspace_id}|${r.key}`;
    case 'keyword_index': return String(r.norm);
    case 'index_status': return String(r.url);
    default: return String(r.id ?? r.url ?? r.norm ?? JSON.stringify(r).slice(0, 80));
  }
}

function tableExists(conn, t) {
  return !!conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
}

// Every workspace that has data: 'admin' (super-admin / main DB), each owner's
// workspace from the users table, AND any local workspace DB file on disk.
function listWorkspaces() {
  const set = new Set(workspaceIds());
  try { for (const u of shared.prepare('SELECT DISTINCT workspace_id FROM users').all()) if (u.workspace_id) set.add(u.workspace_id); } catch { /* users table may not exist yet */ }
  return [...set];
}

// Collect rows for a set of tables on a given connection (synchronous).
function collect(conn, tables) {
  const out = {};
  for (const t of tables) if (tableExists(conn, t)) out[t] = conn.prepare(`SELECT * FROM ${t}`).all();
  return out;
}

// Push a set of {table: rows} for one workspace tag to Supabase. Returns
// { ws, total, errors }. Shared low-level helper used by run() and the sync svc.
async function pushRows(ws, tableRows) {
  const now = new Date().toISOString();
  let total = 0; const errors = [];
  for (const [t, rows] of Object.entries(tableRows)) {
    try {
      const recs = rows.map((r) => ({ table_name: t, record_id: recordId(t, r), data: r, updated_at: now }));
      for (let i = 0; i < recs.length; i += 200) {
        await supabase.upsert('backup_records', recs.slice(i, i + 200), { onConflict: 'workspace_id,table_name,record_id', workspaceId: ws });
      }
      total += recs.length;
    } catch (e) { errors.push(`${ws}/${t}: ${e.message}`); log.warn('backup', `${ws}/${t}: ${e.message}`); }
  }
  return { ws, total, errors };
}

// Push the SHARED tables (settings/users/tenant_settings) → '_shared'.
export async function pushShared() {
  if (!supabase.configured()) return { ws: SHARED_WS, total: 0, errors: [] };
  return pushRows(SHARED_WS, collect(shared, SHARED_TABLES));
}
// Push ONE workspace's content tables (read from that workspace's own DB).
export async function pushWorkspace(ws) {
  if (!supabase.configured()) return { ws, total: 0, errors: [] };
  const rows = tenancy.run({ workspaceId: ws, isSuperAdmin: ws === 'admin' }, () => collect(db, CONTENT_TABLES));
  return pushRows(ws, rows);
}

export async function run() {
  if (!supabase.configured()) throw new Error('Supabase is not connected (set SUPABASE_URL + SUPABASE_SERVICE_KEY in .env).');
  const summary = { workspaces: {}, total: 0, errors: [] };
  const record = (r) => { summary.workspaces[r.ws] = r.total; summary.total += r.total; if (r.errors.length) summary.errors.push(...r.errors); };

  // 1) Shared tables, then 2) each workspace's content.
  record(await pushShared());
  for (const ws of listWorkspaces()) record(await pushWorkspace(ws));

  cfg.set('supabase_last_backup', new Date().toISOString());
  log.info('backup', `Backed up ${summary.total} records across ${Object.keys(summary.workspaces).length} workspaces to Supabase`);
  return summary;
}

// Apply rows into a table on a connection. `mode`:
//   'fill'    — INSERT OR IGNORE (never overwrite local; safe manual restore)
//   'replace' — INSERT OR REPLACE (cloud wins; used by authoritative hydration)
function applyRows(conn, t, rows, mode) {
  if (!tableExists(conn, t) || !rows.length) return 0;
  const cols = conn.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  const verb = mode === 'replace' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  let n = 0;
  const tx = conn.transaction((list) => {
    for (const row of list) {
      const keys = Object.keys(row).filter((k) => cols.includes(k));
      if (!keys.length) continue;
      const ph = keys.map(() => '?').join(',');
      try { conn.prepare(`${verb} INTO ${t}(${keys.join(',')}) VALUES(${ph})`).run(...keys.map((k) => row[k])); n++; } catch { /* skip bad row */ }
    }
  });
  tx(rows); return n;
}

// Pull records back from Supabase across ALL workspaces and apply them locally.
// `mode` defaults to 'fill' (non-destructive). 'replace' makes the cloud the
// source of truth (used by boot hydration once a clean round-trip is verified).
export async function restore({ mode = 'fill' } = {}) {
  if (!supabase.configured()) throw new Error('Supabase is not connected.');
  const recs = await supabase.selectAll('backup_records');
  // Group by workspace → table → rows.
  const byWs = {};
  for (const r of recs) {
    const ws = r.workspace_id || SHARED_WS;
    (byWs[ws] = byWs[ws] || {});
    (byWs[ws][r.table_name] = byWs[ws][r.table_name] || []).push(r.data);
  }
  const summary = { mode, workspaces: {}, total: 0 };

  // Shared tables first (so users exist before per-workspace content). FK
  // enforcement is disabled during the apply so insert order doesn't matter and
  // an OR REPLACE on a parent can't cascade-delete children we just inserted.
  if (byWs[SHARED_WS]) {
    let n = 0;
    shared.pragma('foreign_keys = OFF');
    try { for (const [t, rows] of Object.entries(byWs[SHARED_WS])) if (SHARED_TABLES.includes(t)) n += applyRows(shared, t, rows, mode); }
    finally { shared.pragma('foreign_keys = ON'); }
    summary.workspaces[SHARED_WS] = n; summary.total += n;
    delete byWs[SHARED_WS];
  }

  // Per-workspace content.
  for (const [ws, tables] of Object.entries(byWs)) {
    const n = tenancy.run({ workspaceId: ws, isSuperAdmin: ws === 'admin' }, () => {
      let c = 0;
      db.pragma('foreign_keys = OFF');
      try { for (const [t, rows] of Object.entries(tables)) if (CONTENT_TABLES.includes(t)) c += applyRows(db, t, rows, mode); }
      finally { db.pragma('foreign_keys = ON'); }
      return c;
    });
    summary.workspaces[ws] = n; summary.total += n;
  }

  log.info('backup', `Restored ${summary.total} records from Supabase (mode=${mode})`);
  return summary;
}

// Authoritative pull used on boot: cloud overwrites the local cache. Guarded by
// the caller (only run when Supabase is configured AND a backup exists).
export async function hydrate() {
  return restore({ mode: 'replace' });
}

export function status() {
  return {
    configured: supabase.configured(),
    workspace: supabase.workspaceId(),
    workspaces: listWorkspaces(),
    lastBackup: cfg.get('supabase_last_backup') || null,
    auto: cfg.getBool('supabase_auto_backup'),
  };
}

export default { run, restore, hydrate, status, pushShared, pushWorkspace };
