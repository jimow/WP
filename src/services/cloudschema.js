// First-class Supabase schema: instead of one generic JSONB "backup_records"
// blob, every entity gets its OWN real Postgres table (wpa_users, wpa_articles,
// wpa_clusters, …), each owned by a workspace via the `ws` column. This is the
// single source of truth for BOTH the downloadable schema SQL and the sync layer,
// and the columns are INTROSPECTED from the live SQLite schema so they never drift.
import { shared } from '../db.js';

// Shared/global entities (one set for the whole install) → stored under ws='_shared'.
export const SHARED_TABLES = ['users', 'settings', 'tenant_settings'];
// Per-workspace content entities → ws = the owning tenant ('admin' or ws_xxx).
export const CONTENT_TABLES = ['articles', 'clusters', 'cluster_items', 'pages', 'keywords', 'keyword_index', 'optimizations', 'rank_snapshots', 'index_status', 'post_analyses'];
export const ALL_TABLES = [...SHARED_TABLES, ...CONTENT_TABLES];

// Natural primary key per table (beyond the ws partition column).
const PK = {
  keyword_index: ['norm'],
  index_status: ['url'],
  post_analyses: ['target_ref'],
  settings: ['key'],
  tenant_settings: ['workspace_id', 'key'],
};
export const pkOf = (t) => PK[t] || ['id'];
export const cloudName = (t) => 'wpa_' + t;        // Postgres table name
export const wsOf = (table, tenant) => SHARED_TABLES.includes(table) ? '_shared' : tenant;

function pgType(sqliteType) {
  const t = String(sqliteType || '').toUpperCase();
  if (t.includes('INT')) return 'bigint';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'double precision';
  return 'text'; // text, dates (ISO strings), JSON-as-text, everything else
}
const q = (id) => `"${id}"`; // quote identifiers (cols like "before"/"after"/"date" are reserved)

// Columns of a local table (main DB carries every table's schema).
export function columnsOf(table) {
  return shared.prepare(`PRAGMA table_info(${table})`).all().map((c) => ({ name: c.name, pg: pgType(c.type) }));
}

// Generate the full Postgres schema (run once in the Supabase SQL editor). Safe
// to re-run; adds workspace-scoped RLS (the service_role key the app uses bypasses
// RLS, so sync works immediately; the policies prepare for per-tenant browser auth).
export function schemaSql() {
  let sql = `-- ============================================================================
-- WP Autopilot — first-class Supabase schema (one real table per entity).
-- Run in your Supabase project: SQL editor → New query → paste → Run. Re-runnable.
-- The app writes with the service_role key (bypasses RLS). Every row is owned by
-- a workspace via the "ws" column ('_shared' for users/settings, else the tenant).
-- ============================================================================

`;
  for (const t of ALL_TABLES) {
    const cols = columnsOf(t);
    if (!cols.length) continue;
    const pk = ['ws', ...pkOf(t)];
    const cn = cloudName(t);
    sql += `create table if not exists public.${cn} (\n  "ws" text not null,\n`;
    sql += cols.map((c) => `  ${q(c.name)} ${c.pg}`).join(',\n');
    sql += `,\n  primary key (${pk.map(q).join(', ')})\n);\n`;
    sql += `create index if not exists ${cn}_ws_idx on public.${cn} ("ws");\n`;
    sql += `alter table public.${cn} enable row level security;\n`;
    sql += `drop policy if exists ${cn}_self on public.${cn};\n`;
    sql += `create policy ${cn}_self on public.${cn} for all to authenticated\n  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));\n\n`;
  }
  return sql;
}

export default { SHARED_TABLES, CONTENT_TABLES, ALL_TABLES, pkOf, cloudName, wsOf, columnsOf, schemaSql };
