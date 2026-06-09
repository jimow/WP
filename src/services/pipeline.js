// The automation "tick". Called on a schedule (or manually). It moves work
// through the funnel while respecting the autonomy setting:
//
//   draft_approve : generate drafts only. Human approves → publish.
//   auto_articles : generate AND auto-publish articles. Pages still need approval.
//   full_auto     : generate AND auto-publish articles and pages.
//
// A daily article quota (articles_per_day) caps how much it generates/publishes.
import db from '../db.js';
import cfg from '../config.js';
import log from '../log.js';
import articles from './articles.js';
import optimize from './optimize.js';
import gsc from '../clients/gsc.js';
import replenish from './replenish.js';
import calendar from './calendar.js';
import ranktrack from './ranktrack.js';
import indexmon from './indexmon.js';
import postintel from './postintel.js';
import distribute from './distribute.js';
import ahrefs from '../clients/ahrefs.js';
import supabase from '../clients/supabase.js';
import backup from './backup.js';

function publishedToday() {
  return db.prepare(
    "SELECT COUNT(*) n FROM articles WHERE status='published' AND date(updated_at)=date('now')"
  ).get().n;
}

function optimizedToday() {
  return db.prepare(
    "SELECT COUNT(*) n FROM optimizations WHERE date(created_at)=date('now')"
  ).get().n;
}

function generatedToday() {
  return db.prepare(
    "SELECT COUNT(*) n FROM articles WHERE status IN ('pending_review','approved','published') AND date(updated_at)=date('now')"
  ).get().n;
}

export async function tick({ manual = false } = {}) {
  if (!cfg.getBool('automation_enabled') && !manual) return { skipped: 'automation disabled' };

  const runInfo = db.prepare("INSERT INTO runs(started_at) VALUES(datetime('now'))").run();
  const runId = runInfo.lastInsertRowid;
  const summary = { replenished: 0, generated: 0, published: 0, scheduled: 0, optimized: 0, errors: [] };
  const autonomy = cfg.get('autonomy');
  const quota = cfg.getInt('articles_per_day', 3);

  try {
    // 0) Self-replenish the idea queue so the loop never starves (owner-toggleable).
    if (cfg.getBool('auto_replenish')) {
      try {
        const r = await replenish.run();
        summary.replenished = r.added;
      } catch (e) { summary.errors.push(`replenish: ${e.message}`); }
    }

    // 1) Generate drafts from ideas, up to remaining daily quota (owner-toggleable).
    let budget = cfg.getBool('pipeline_generate') ? Math.max(0, quota - generatedToday()) : 0;
    const ideas = db.prepare("SELECT id FROM articles WHERE status='idea' ORDER BY created_at ASC LIMIT ?").all(budget);
    for (const { id } of ideas) {
      try {
        const art = await articles.generate(id);
        summary.generated++;
        // Auto-approve only when safe: a flagged duplicate-keyword draft waits for
        // the owner to confirm (never auto-adopted by the 24/7 loop).
        if ((autonomy === 'auto_articles' || autonomy === 'full_auto')) {
          if (art && art.kw_warning) {
            summary.heldForReview = (summary.heldForReview || 0) + 1;
            distribute.notify('kw-duplicate', `Draft "${art.title || art.keyword}" held for review: ${art.kw_warning}`, { level: 'warn' }).catch(() => {});
          } else {
            articles.setStatus(id, 'approved'); // auto-approve so step 2 publishes it
          }
        }
      } catch (e) {
        summary.errors.push(`generate#${id}: ${e.message}`);
      }
    }

    // 2) Publish (or schedule) approved articles, up to remaining publish quota.
    let pubBudget = cfg.getBool('pipeline_publish') ? Math.max(0, quota - publishedToday()) : 0;
    // Never auto-publish a still-flagged duplicate — it must be confirmed first.
    const approved = db.prepare("SELECT id FROM articles WHERE status='approved' AND kw_warning IS NULL ORDER BY updated_at ASC LIMIT ?").all(pubBudget);
    const scheduled = cfg.get('publish_cadence') === 'scheduled';
    const slots = scheduled ? calendar.nextSlots(approved.length) : [];
    for (let i = 0; i < approved.length; i++) {
      const { id } = approved[i];
      try {
        if (scheduled && slots[i]) {
          await articles.publish(id, { scheduledDate: slots[i] });
          summary.scheduled++;
        } else {
          await articles.publish(id);
          summary.published++;
        }
      } catch (e) {
        summary.errors.push(`publish#${id}: ${e.message}`);
      }
    }

    // 3) GSC-driven optimization: prepare (and maybe auto-apply) top fixes.
    if (cfg.getBool('auto_optimize') && gsc.configured()) {
      try {
        const optBudget = Math.max(0, cfg.getInt('optimize_per_day', 2) - optimizedToday());
        if (optBudget > 0) {
          const { opportunities } = await optimize.scan(28);
          const actionable = opportunities.filter((o) => o.type === 'ctr' || o.type === 'refresh').slice(0, optBudget);
          for (const o of actionable) {
            try {
              const prepared = o.type === 'ctr' ? await optimize.prepareCtr(o.url) : await optimize.prepareRefresh(o.url);
              if (autonomy === 'full_auto') await optimize.apply(prepared.id);
              summary.optimized++;
            } catch (e) {
              summary.errors.push(`optimize ${o.type} ${o.url}: ${e.message}`);
            }
          }
          // Content gaps → article ideas (only when there's article-generation headroom).
          for (const g of opportunities.filter((o) => o.type === 'gap').slice(0, 3)) {
            try { optimize.gapToIdea(g.query); } catch { /* ignore */ }
          }
        }
      } catch (e) {
        summary.errors.push(`optimize: ${e.message}`);
      }
    }

    // 4) Rank tracking: take a daily snapshot, then auto-refresh decliners that
    //    have slipped beyond the owner's threshold (shares the optimize budget).
    if (cfg.getBool('rank_tracking') && gsc.configured()) {
      try {
        if (!ranktrack.hasSnapshotToday()) {
          const snap = await ranktrack.snapshot();
          summary.snapshotted = snap.rows || 0;
        }
        if (cfg.getBool('auto_refresh_decliners')) {
          let refreshBudget = Math.max(0, cfg.getInt('optimize_per_day', 2) - optimizedToday());
          for (const d of ranktrack.decliners()) {
            if (refreshBudget <= 0) break;
            // Skip if we already prepared/applied a refresh for this URL recently.
            const recent = db.prepare(
              "SELECT 1 FROM optimizations WHERE target_url=? AND type='refresh' AND status IN ('prepared','applied') AND created_at > datetime('now','-7 day') LIMIT 1"
            ).get(d.url);
            if (recent) continue;
            try {
              const prepared = await optimize.prepareRefresh(d.url);
              if (autonomy === 'full_auto') await optimize.apply(prepared.id);
              summary.refreshed = (summary.refreshed || 0) + 1;
              refreshBudget--;
            } catch (e) { summary.errors.push(`decliner-refresh ${d.url}: ${e.message}`); }
          }
        }
      } catch (e) {
        summary.errors.push(`ranktrack: ${e.message}`);
      }
    }

    // 5) Index monitoring: check coverage of recently published posts (rate-limited).
    if (cfg.getBool('indexing_monitor') && gsc.configured()) {
      try {
        const r = await indexmon.monitorRecent(cfg.getInt('index_check_per_tick', 3));
        summary.indexChecked = r.checked;
      } catch (e) { summary.errors.push(`indexmon: ${e.message}`); }
    }

    // 6.5) Auto content-gap analysis: continuously compare existing pages against
    //      the LIVE Google top-10 for their focus keyword (rate-limited, rotating),
    //      saving an analysis + apply-ready edits on each. Skips if Ahrefs is off.
    if (cfg.getBool('auto_gap_analysis') && ahrefs.configured()) {
      try {
        const r = await postintel.autoAnalyzeDue({
          limit: cfg.getInt('gap_analysis_per_tick', 2),
          intervalDays: cfg.getInt('gap_analysis_interval_days', 30),
        });
        summary.gapAnalyzed = r.analyzed;
        if (r.errors.length) summary.errors.push(...r.errors.map((e) => `gap-analysis ${e}`));
      } catch (e) { summary.errors.push(`gap-analysis: ${e.message}`); }
    }

    // 6) Cloud persistence: daily Supabase backup (best-effort, throttled to ~20h).
    if (cfg.getBool('supabase_auto_backup') && supabase.configured()) {
      try {
        const last = cfg.get('supabase_last_backup');
        const stale = !last || (Date.now() - new Date(last).getTime()) > 20 * 3600 * 1000;
        if (stale) { const b = await backup.run(); summary.backedUp = b.total; }
      } catch (e) { summary.errors.push(`backup: ${e.message}`); }
    }
  } catch (e) {
    summary.errors.push(`tick: ${e.message}`);
  }

  db.prepare("UPDATE runs SET finished_at=datetime('now'), summary=? WHERE id=?")
    .run(JSON.stringify(summary), runId);
  log.info('pipeline', `tick done: +${summary.replenished} ideas, +${summary.generated} drafts, +${summary.published} published, +${summary.scheduled} scheduled, ${summary.errors.length} errors`);
  // Notify on errors (best-effort, gated by settings).
  if (summary.errors.length) {
    distribute.notify('tick-errors', `Pipeline tick had ${summary.errors.length} error(s): ${summary.errors.slice(0, 3).join(' | ')}`, { level: 'error', data: { errors: summary.errors } }).catch(() => {});
  } else if ((summary.published || summary.scheduled) && cfg.getBool('notify_publish')) {
    distribute.notify('tick-published', `Published ${summary.published}, scheduled ${summary.scheduled} new post(s).`, { level: 'info' }).catch(() => {});
  }
  return summary;
}

export default { tick };
