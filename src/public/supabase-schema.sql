-- ============================================================================
-- WP Autopilot — Supabase schema
-- Run this in your Supabase project's SQL editor (Database → SQL editor → New
-- query → paste → Run). It creates the cloud-persistence store and the
-- multi-tenant foundation. Safe to re-run.
-- ============================================================================

-- Tenants. Each WP Autopilot install / customer is a "workspace".
create table if not exists public.workspaces (
  id          text primary key,              -- your Workspace ID from Settings
  name        text,
  created_at  timestamptz not null default now()
);

-- Generic cloud backup mirror. Every local row is stored as JSONB keyed by
-- (workspace_id, table_name, record_id) — schema never drifts.
create table if not exists public.backup_records (
  workspace_id text not null,
  table_name   text not null,
  record_id    text not null,
  data         jsonb not null,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, table_name, record_id)
);
create index if not exists backup_records_ws_table_idx
  on public.backup_records (workspace_id, table_name);

-- ---- Row Level Security ----------------------------------------------------
-- The service_role key (used by the app server) BYPASSES RLS, so backups work
-- immediately. These policies prepare for per-tenant browser/auth access later:
-- an authenticated user only sees rows for their own workspace_id claim.
alter table public.workspaces      enable row level security;
alter table public.backup_records  enable row level security;

drop policy if exists ws_self on public.workspaces;
create policy ws_self on public.workspaces
  for all to authenticated
  using (id = (auth.jwt() ->> 'workspace_id'))
  with check (id = (auth.jwt() ->> 'workspace_id'));

drop policy if exists backup_self on public.backup_records;
create policy backup_self on public.backup_records
  for all to authenticated
  using (workspace_id = (auth.jwt() ->> 'workspace_id'))
  with check (workspace_id = (auth.jwt() ->> 'workspace_id'));

-- ============================================================================
-- NEXT PHASE (full multi-tenant read/write): create first-class per-entity
-- tables below and point the app's data layer at them. Each carries
-- workspace_id + RLS like above. Provided as a starting point — uncomment and
-- extend as you migrate services off the generic backup_records mirror.
-- ============================================================================
-- create table if not exists public.articles (
--   workspace_id text not null,
--   id           bigint not null,
--   keyword      text, title text, slug text, content text, status text,
--   focus_keyword text, seo_score int, wp_post_id bigint, wp_url text,
--   updated_at   timestamptz default now(),
--   primary key (workspace_id, id)
-- );
-- alter table public.articles enable row level security;
-- create policy articles_self on public.articles for all to authenticated
--   using (workspace_id = (auth.jwt() ->> 'workspace_id'))
--   with check (workspace_id = (auth.jwt() ->> 'workspace_id'));
