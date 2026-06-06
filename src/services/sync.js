// Supabase-as-primary sync.
//
// When `supabase_primary` is ON and Supabase is connected (via .env), Supabase
// becomes the SOURCE OF TRUTH and the local SQLite files are a hot cache:
//   • on boot we HYDRATE the cache from the cloud (authoritative, cloud wins),
//   • during runtime we MIRROR every change up — db.js marks the changed
//     workspace dirty, and this service flushes dirty workspaces (+ the shared
//     tables) to Supabase on a short interval.
// When the toggle is OFF (default) this is inert: local stays primary, the cloud
// is touched only by manual "Back up now" / "Restore".
import { setSyncEnabled, drainDirty } from '../db.js';
import cfg from '../config.js';
import log from '../log.js';
import supabase from '../clients/supabase.js';
import backup from './backup.js';

let timer = null;
let flushing = false;
let tick = 0;

// Active only when connected AND the owner opted in.
export function primaryMode() { return supabase.configured() && cfg.getBool('supabase_primary'); }

// Boot: pull the cloud into the local cache (cloud wins). Safe when the cloud is
// empty (restore applies only tables that exist in the cloud payload → no-op, so
// a fresh/empty Supabase never wipes local data).
export async function hydrateOnBoot() {
  if (!primaryMode()) return { skipped: true };
  log.info('sync', 'Supabase primary mode: hydrating local cache from the cloud…');
  const r = await backup.hydrate(); // restore({ mode: 'replace' }) across all workspaces
  log.info('sync', `Hydrated ${r.total} records from Supabase across ${Object.keys(r.workspaces || {}).length} workspaces`);
  return r;
}

// Push the shared tables + any dirty workspaces up to the cloud.
export async function flush(force = false) {
  if (!primaryMode() || flushing) return { skipped: true };
  const workspaces = drainDirty();
  tick++;
  // Always mirror shared (settings/users/tenant_settings) when content changed,
  // and at least every ~6 ticks to catch settings writes that bypass the proxy.
  const doShared = force || workspaces.length > 0 || tick % 6 === 0;
  if (!workspaces.length && !doShared) return { skipped: true };
  flushing = true;
  let pushed = 0;
  try {
    if (doShared) await backup.pushShared();
    const seen = new Set();
    for (const ws of workspaces) { if (seen.has(ws)) continue; seen.add(ws); await backup.pushWorkspace(ws); pushed++; }
    if (pushed) log.info('sync', `Mirrored ${pushed} workspace(s) to Supabase`);
  } catch (e) { log.warn('sync', `flush failed: ${e.message}`); }
  finally { flushing = false; }
  return { pushed };
}

export function start(intervalMs = 10000) {
  setSyncEnabled(primaryMode()); // turn on db.js dirty-tracking only in primary mode
  if (!primaryMode()) return;
  if (timer) clearInterval(timer);
  timer = setInterval(() => { flush().catch(() => {}); }, intervalMs);
  if (timer.unref) timer.unref();
  log.info('sync', `Supabase write-through mirror started (every ${intervalMs / 1000}s)`);
}

export function stop() { if (timer) clearInterval(timer); timer = null; setSyncEnabled(false); }

export function status() {
  return { primary: primaryMode(), configured: supabase.configured(), optedIn: cfg.getBool('supabase_primary') };
}

export default { hydrateOnBoot, flush, start, stop, status, primaryMode };
