// Cloud persistence — mirror local SQLite into Supabase as FIRST-CLASS TABLES.
// Each entity has its own Postgres table (wpa_users, wpa_articles, wpa_clusters,
// …, defined in cloudschema.js), and every row is owned by a workspace via the
// `ws` column ('_shared' for users/settings/tenant_settings, else the tenant).
//
//   • SHARED tables (users, settings, tenant_settings) → ws='_shared'.
//   • CONTENT tables (articles, clusters, …) → ws = the owning tenant.
// Same exported API as before (run/restore/hydrate/pushShared/pushWorkspace) so
// the sync service and routes are unchanged — only the storage shape changed.
import db, { shared, workspaceIds } from '../db.js';
import cfg from '../config.js';
import log from '../log.js';
import tenancy from '../tenancy.js';
import supabase from '../clients/supabase.js';
import { SHARED_TABLES, CONTENT_TABLES, cloudName, pkOf } from './cloudschema.js';

const SHARED_WS = '_shared';

function tableExists(conn, t) {
  return !!conn.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
}

// Every workspace that has data: 'admin' (main DB) + each owner's workspace +
// any local workspace DB file on disk.
function listWorkspaces() {
  const set = new Set(workspaceIds());
  try { for (const u of shared.prepare('SELECT DISTINCT workspace_id FROM users').all()) if (u.workspace_id) set.add(u.workspace_id); } catch { /* */ }
  return [...set];
}

function collect(conn, tables) {
  const out = {};
  for (const t of tables) if (tableExists(conn, t)) out[t] = conn.prepare(`SELECT * FROM ${t}`).all();
  return out;
}

// Push {table: rows} for one workspace tag → each table's own wpa_* table.
async function pushRows(ws, tableRows) {
  let total = 0; const errors = [];
  for (const [t, rows] of Object.entries(tableRows)) {
    if (!rows.length) continue;
    try {
      const onConflict = ['ws', ...pkOf(t)].join(',');
      const tagged = rows.map((r) => ({ ws, ...r }));
      for (let i = 0; i < tagged.length; i += 200) {
        await supabase.upsertRows(cloudName(t), tagged.slice(i, i + 200), { onConflict });
      }
      total += tagged.length;
    } catch (e) { errors.push(`${ws}/${t}: ${e.message}`); log.warn('backup', `${ws}/${t}: ${e.message}`); }
  }
  return { ws, total, errors };
}

export async function pushShared() {
  if (!supabase.configured()) return { ws: SHARED_WS, total: 0, errors: [] };
  return pushRows(SHARED_WS, collect(shared, SHARED_TABLES));
}
export async function pushWorkspace(ws) {
  if (!supabase.configured()) return { ws, total: 0, errors: [] };
  const rows = tenancy.run({ workspaceId: ws, isSuperAdmin: ws === 'admin' }, () => collect(db, CONTENT_TABLES));
  return pushRows(ws, rows);
}

export async function run() {
  if (!supabase.configured()) throw new Error('Supabase is not connected (set SUPABASE_URL + SUPABASE_SERVICE_KEY in .env).');
  const summary = { workspaces: {}, total: 0, errors: [] };
  const record = (r) => { summary.workspaces[r.ws] = r.total; summary.total += r.total; if (r.errors.length) summary.errors.push(...r.errors); };
  record(await pushShared());
  for (const ws of listWorkspaces()) record(await pushWorkspace(ws));
  cfg.set('supabase_last_backup', new Date().toISOString());
  if (summary.total === 0 && summary.errors.some((e) => /could not find the table|schema cache|does not exist|relation|404|PGRST/i.test(e))) {
    throw new Error('The first-class tables don’t exist in Supabase yet. Run the schema: Settings → Supabase → Download schema SQL → paste & run it in the Supabase SQL editor, then back up again.');
  }
  log.info('backup', `Backed up ${summary.total} records across ${Object.keys(summary.workspaces).length} workspaces (first-class tables)`);
  return summary;
}

// Apply rows into a local table. mode 'fill'=INSERT OR IGNORE, 'replace'=INSERT OR REPLACE.
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

// Pull every wpa_* table back and apply locally. 'fill' non-destructive,
// 'replace' = cloud wins (boot hydration).
export async function restore({ mode = 'fill' } = {}) {
  if (!supabase.configured()) throw new Error('Supabase is not connected.');
  const summary = { mode, workspaces: {}, total: 0, errors: [] };
  const bump = (ws, n) => { summary.workspaces[ws] = (summary.workspaces[ws] || 0) + n; summary.total += n; };

  // Shared tables → shared (main) DB. FK off so insert order / replace-cascade is safe.
  shared.pragma('foreign_keys = OFF');
  try {
    for (const t of SHARED_TABLES) {
      try {
        const rows = await supabase.selectRows(cloudName(t));
        bump(SHARED_WS, applyRows(shared, t, rows.map(({ ws, ...r }) => r), mode));
      } catch (e) { summary.errors.push(`_shared/${t}: ${e.message}`); }
    }
  } finally { shared.pragma('foreign_keys = ON'); }

  // Content tables → grouped by ws, applied to each workspace's own DB.
  for (const t of CONTENT_TABLES) {
    let rows;
    try { rows = await supabase.selectRows(cloudName(t)); }
    catch (e) { summary.errors.push(`content/${t}: ${e.message}`); continue; }
    const byWs = {};
    for (const r of rows) { const { ws, ...rest } = r; (byWs[ws || 'admin'] = byWs[ws || 'admin'] || []).push(rest); }
    for (const [ws, list] of Object.entries(byWs)) {
      const n = tenancy.run({ workspaceId: ws, isSuperAdmin: ws === 'admin' }, () => {
        db.pragma('foreign_keys = OFF');
        try { return applyRows(db, t, list, mode); } finally { db.pragma('foreign_keys = ON'); }
      });
      bump(ws, n);
    }
  }
  log.info('backup', `Restored ${summary.total} records from Supabase (mode=${mode}, first-class tables)`);
  return summary;
}

export async function hydrate() { return restore({ mode: 'replace' }); }

// Is the first-class schema present in Supabase? (cheap probe of wpa_users.)
export async function schemaReady() {
  if (!supabase.configured()) return false;
  try { await supabase.selectRows(cloudName('users'), { limit: 1 }); return true; }
  catch { return false; }
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

export default { run, restore, hydrate, status, pushShared, pushWorkspace, schemaReady };
