-- ============================================================================
-- WP Autopilot — first-class Supabase schema (one real table per entity).
-- Run in your Supabase project: SQL editor → New query → paste → Run. Re-runnable.
-- The app writes with the service_role key (bypasses RLS). Every row is owned by
-- a workspace via the "ws" column ('_shared' for users/settings, else the tenant).
-- ============================================================================

create table if not exists public.wpa_users (
  "ws" text not null,
  "id" bigint,
  "email" text,
  "name" text,
  "password_hash" text,
  "role" text,
  "workspace_id" text,
  "reset_token" text,
  "reset_expires" text,
  "created_at" text,
  "last_login" text,
  primary key ("ws", "id")
);
create index if not exists wpa_users_ws_idx on public.wpa_users ("ws");
alter table public.wpa_users enable row level security;
drop policy if exists wpa_users_self on public.wpa_users;
create policy wpa_users_self on public.wpa_users for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_settings (
  "ws" text not null,
  "key" text,
  "value" text,
  primary key ("ws", "key")
);
create index if not exists wpa_settings_ws_idx on public.wpa_settings ("ws");
alter table public.wpa_settings enable row level security;
drop policy if exists wpa_settings_self on public.wpa_settings;
create policy wpa_settings_self on public.wpa_settings for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_tenant_settings (
  "ws" text not null,
  "workspace_id" text,
  "key" text,
  "value" text,
  primary key ("ws", "workspace_id", "key")
);
create index if not exists wpa_tenant_settings_ws_idx on public.wpa_tenant_settings ("ws");
alter table public.wpa_tenant_settings enable row level security;
drop policy if exists wpa_tenant_settings_self on public.wpa_tenant_settings;
create policy wpa_tenant_settings_self on public.wpa_tenant_settings for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_articles (
  "ws" text not null,
  "id" bigint,
  "cluster_id" bigint,
  "keyword" text,
  "title" text,
  "slug" text,
  "content" text,
  "excerpt" text,
  "meta_description" text,
  "role" text,
  "status" text,
  "wp_post_id" bigint,
  "wp_url" text,
  "scheduled_for" text,
  "error" text,
  "created_at" text,
  "updated_at" text,
  "published_at" text,
  "focus_keyword" text,
  "seo_score" bigint,
  "tags" text,
  "faq" text,
  "image_alts" text,
  "kw_warning" text,
  primary key ("ws", "id")
);
create index if not exists wpa_articles_ws_idx on public.wpa_articles ("ws");
alter table public.wpa_articles enable row level security;
drop policy if exists wpa_articles_self on public.wpa_articles;
create policy wpa_articles_self on public.wpa_articles for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_clusters (
  "ws" text not null,
  "id" bigint,
  "name" text,
  "hub_keyword" text,
  "intent" text,
  "status" text,
  "wp_page_id" bigint,
  "created_at" text,
  primary key ("ws", "id")
);
create index if not exists wpa_clusters_ws_idx on public.wpa_clusters ("ws");
alter table public.wpa_clusters enable row level security;
drop policy if exists wpa_clusters_self on public.wpa_clusters;
create policy wpa_clusters_self on public.wpa_clusters for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_cluster_items (
  "ws" text not null,
  "id" bigint,
  "cluster_id" bigint,
  "keyword" text,
  "role" text,
  "article_id" bigint,
  "created_at" text,
  primary key ("ws", "id")
);
create index if not exists wpa_cluster_items_ws_idx on public.wpa_cluster_items ("ws");
alter table public.wpa_cluster_items enable row level security;
drop policy if exists wpa_cluster_items_self on public.wpa_cluster_items;
create policy wpa_cluster_items_self on public.wpa_cluster_items for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_pages (
  "ws" text not null,
  "id" bigint,
  "title" text,
  "slug" text,
  "kind" text,
  "content" text,
  "status" text,
  "wp_page_id" bigint,
  "wp_url" text,
  "error" text,
  "created_at" text,
  "updated_at" text,
  "published_at" text,
  "meta_description" text,
  primary key ("ws", "id")
);
create index if not exists wpa_pages_ws_idx on public.wpa_pages ("ws");
alter table public.wpa_pages enable row level security;
drop policy if exists wpa_pages_self on public.wpa_pages;
create policy wpa_pages_self on public.wpa_pages for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_keywords (
  "ws" text not null,
  "id" bigint,
  "keyword" text,
  "volume" bigint,
  "difficulty" bigint,
  "cpc" double precision,
  "intent" text,
  "parent_topic" text,
  "source" text,
  "status" text,
  "created_at" text,
  primary key ("ws", "id")
);
create index if not exists wpa_keywords_ws_idx on public.wpa_keywords ("ws");
alter table public.wpa_keywords enable row level security;
drop policy if exists wpa_keywords_self on public.wpa_keywords;
create policy wpa_keywords_self on public.wpa_keywords for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_keyword_index (
  "ws" text not null,
  "norm" text,
  "keyword" text,
  "url" text,
  "source" text,
  "built_at" text,
  primary key ("ws", "norm")
);
create index if not exists wpa_keyword_index_ws_idx on public.wpa_keyword_index ("ws");
alter table public.wpa_keyword_index enable row level security;
drop policy if exists wpa_keyword_index_self on public.wpa_keyword_index;
create policy wpa_keyword_index_self on public.wpa_keyword_index for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_optimizations (
  "ws" text not null,
  "id" bigint,
  "type" text,
  "target_url" text,
  "query" text,
  "post_id" bigint,
  "post_type" text,
  "metrics" text,
  "before" text,
  "after" text,
  "gain" bigint,
  "status" text,
  "note" text,
  "created_at" text,
  "applied_at" text,
  primary key ("ws", "id")
);
create index if not exists wpa_optimizations_ws_idx on public.wpa_optimizations ("ws");
alter table public.wpa_optimizations enable row level security;
drop policy if exists wpa_optimizations_self on public.wpa_optimizations;
create policy wpa_optimizations_self on public.wpa_optimizations for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_rank_snapshots (
  "ws" text not null,
  "id" bigint,
  "date" text,
  "url" text,
  "position" double precision,
  "impressions" bigint,
  "clicks" bigint,
  "ctr" double precision,
  "captured_at" text,
  primary key ("ws", "id")
);
create index if not exists wpa_rank_snapshots_ws_idx on public.wpa_rank_snapshots ("ws");
alter table public.wpa_rank_snapshots enable row level security;
drop policy if exists wpa_rank_snapshots_self on public.wpa_rank_snapshots;
create policy wpa_rank_snapshots_self on public.wpa_rank_snapshots for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_index_status (
  "ws" text not null,
  "url" text,
  "verdict" text,
  "coverage" text,
  "last_crawl" text,
  "submitted_at" text,
  "checked_at" text,
  primary key ("ws", "url")
);
create index if not exists wpa_index_status_ws_idx on public.wpa_index_status ("ws");
alter table public.wpa_index_status enable row level security;
drop policy if exists wpa_index_status_self on public.wpa_index_status;
create policy wpa_index_status_self on public.wpa_index_status for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

create table if not exists public.wpa_post_analyses (
  "ws" text not null,
  "target_ref" text,
  "target_kind" text,
  "keyword" text,
  "result" text,
  "created_at" text,
  primary key ("ws", "target_ref")
);
create index if not exists wpa_post_analyses_ws_idx on public.wpa_post_analyses ("ws");
alter table public.wpa_post_analyses enable row level security;
drop policy if exists wpa_post_analyses_self on public.wpa_post_analyses;
create policy wpa_post_analyses_self on public.wpa_post_analyses for all to authenticated
  using ("ws" = (auth.jwt() ->> 'workspace_id')) with check ("ws" = (auth.jwt() ->> 'workspace_id'));

