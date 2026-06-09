// Multi-tenancy context. A per-request AsyncLocalStorage carries the logged-in
// user's workspace so config.js can resolve PER-TENANT settings (WordPress, GSC,
// brand…) while keeping SHARED settings (AI providers, Ahrefs, Supabase) global.
//
// Model (per the owner's spec):
//   • super_admin  → owns the existing/global settings; reads & writes GLOBAL for
//     everything (so the 24/7 scheduler and current config keep working).
//   • owner        → shares the GLOBAL keys (AI + Ahrefs) but has their OWN
//     per-tenant WordPress/GSC/brand/etc.
//   • no context (background scheduler / before auth) → behaves as today (global).
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

// SHARED across every tenant (managed by the super admin). Everything NOT in this
// set is per-tenant.
export const GLOBAL_KEYS = new Set([
  // AI writers — "deepseek will be used by everyone"
  'ai_provider', 'ai_model', 'ai_model_vision', 'image_model',
  'anthropic_api_key', 'openai_api_key', 'deepseek_api_key',
  // Ahrefs — "ahrefs will be used by everyone"
  'ahrefs_api_token',
  // Platform plumbing (super-admin only)
  'supabase_url', 'supabase_service_key', 'supabase_anon_key',
  'supabase_workspace_id', 'supabase_auto_backup', 'supabase_last_backup',
  'supabase_primary',
  // Platform email (Resend) — one config for the whole install.
  'resend_api_key', 'resend_from',
  // App mode flag.
  'single_tenant',
]);

export function isGlobalKey(key) { return GLOBAL_KEYS.has(key); }
export function run(ctx, fn) { return als.run(ctx, fn); }
export function current() { return als.getStore() || null; }

export default { GLOBAL_KEYS, isGlobalKey, run, current };
