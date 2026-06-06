// node-cron scheduler — the "24/7" heartbeat. Reads the cron expression from
// settings and reschedules itself when the user changes it in the dashboard.
import cron from 'node-cron';
import cfg from './config.js';
import log from './log.js';
import pipeline from './services/pipeline.js';

let task = null;
let current = null;
let running = false;

async function safeTick() {
  if (running) { log.warn('scheduler', 'previous tick still running, skipping'); return; }
  running = true;
  try {
    await pipeline.tick();
  } catch (e) {
    log.error('scheduler', e.message);
  } finally {
    running = false;
  }
}

export function start() {
  apply();
  // Re-check the cron expression every minute so dashboard changes take effect.
  cron.schedule('* * * * *', apply);
  log.info('scheduler', 'started');
}

function apply() {
  const expr = cfg.get('tick_cron') || '*/15 * * * *';
  if (expr === current) return;
  if (!cron.validate(expr)) { log.error('scheduler', `invalid cron "${expr}"`); return; }
  if (task) task.stop();
  task = cron.schedule(expr, safeTick);
  current = expr;
  log.info('scheduler', `pipeline scheduled: "${expr}"`);
}

export default { start };
