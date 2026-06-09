// Supabase (Postgres) client — plain REST (PostgREST), no SDK. Used for cloud
// persistence/backup and as the foundation for multi-tenant SaaS: every row is
// tagged with a workspace_id (the tenant). Configure in Settings → Supabase.
//
// One-time setup the owner does:
//   1. supabase.com → new project.
//   2. Project Settings → API → copy the Project URL + the service_role key.
//   3. Paste them into Settings, set a Workspace ID, click Test.
//   4. Run the downloadable schema SQL in the Supabase SQL editor.
import cfg from '../config.js';

function conf() {
  const url = (cfg.get('supabase_url') || '').trim().replace(/\/+$/, '');
  const key = (cfg.get('supabase_service_key') || '').trim();
  return { url, key };
}

export function configured() {
  const { url, key } = conf();
  return !!(url && key);
}

export function workspaceId() {
  return (cfg.get('supabase_workspace_id') || 'default').trim() || 'default';
}

async function rest(path, { method = 'GET', body, headers = {}, query } = {}) {
  const { url, key } = conf();
  if (!url || !key) throw new Error('Supabase not configured (Settings → Supabase).');
  let full = `${url}/rest/v1/${path}`;
  if (query) { const qs = new URLSearchParams(query).toString(); if (qs) full += `?${qs}`; }
  const res = await fetch(full, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase ${method} ${path} failed: ${data?.message || data?.hint || res.status}`);
  return data;
}

// Cheap connectivity + auth check.
export async function ping() {
  const { url } = conf();
  if (!configured()) return { ok: false, configured: false };
  // The PostgREST root returns the OpenAPI spec; 200 means URL + key are valid.
  const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: conf().key, Authorization: `Bearer ${conf().key}` } });
  if (!res.ok && res.status !== 404) throw new Error(`Supabase auth failed (${res.status}). Check the URL and service_role key.`);
  return { ok: true, configured: true, workspace: workspaceId() };
}

// Upsert rows into a table on a conflict target (default the table's PK).
// Rows are tagged with a workspace_id (tenant). Pass `workspaceId` to target a
// SPECIFIC tenant (real multi-tenancy: each owner's data is tagged with their
// own ws id); otherwise the global Settings workspace id is used.
export async function upsert(table, rows, { onConflict = 'workspace_id,id', workspaceId: ws } = {}) {
  if (!rows || !rows.length) return { count: 0 };
  const tag = ws || workspaceId();
  const tagged = rows.map((r) => ({ workspace_id: tag, ...r }));
  await rest(table, {
    method: 'POST',
    query: { on_conflict: onConflict },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: tagged,
  });
  return { count: tagged.length };
}

// Read rows from a table. Pass `workspaceId` to scope to one tenant, or
// `workspaceId: null` to read ALL workspaces (service_role bypasses RLS — used
// for boot hydration). Defaults to the global Settings workspace id.
export async function select(table, { limit = 5000, order, workspaceId: ws } = {}) {
  const query = { limit: String(limit) };
  if (ws !== null) query.workspace_id = `eq.${ws || workspaceId()}`;
  if (order) query.order = order;
  return rest(table, { query });
}

// Read every workspace's rows (no workspace filter). For hydration/restore-all.
export async function selectAll(table, { limit = 50000, order } = {}) {
  return select(table, { limit, order, workspaceId: null });
}

// --- First-class tables (wpa_*) ---------------------------------------------
// Upsert pre-built rows into ANY table (rows already carry their columns incl
// the `ws` partition). `onConflict` = the table's PK columns (e.g. "ws,id").
export async function upsertRows(table, rows, { onConflict } = {}) {
  if (!rows || !rows.length) return { count: 0 };
  await rest(table, {
    method: 'POST',
    query: { on_conflict: onConflict },
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: rows,
  });
  return { count: rows.length };
}
// Read all rows from a table (no filter; service_role bypasses RLS).
export async function selectRows(table, { limit = 50000, order } = {}) {
  const query = { limit: String(limit) };
  if (order) query.order = order;
  return rest(table, { query });
}
// Delete all rows for a workspace from a wpa_* table (ws = partition column).
export async function deleteWs(table, ws) {
  return rest(table, { method: 'DELETE', query: { ws: `eq.${ws}` }, headers: { Prefer: 'return=minimal' } });
}

export default { configured, workspaceId, ping, upsert, select, selectAll, upsertRows, selectRows, deleteWs };
