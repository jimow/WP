// Headless worker: runs ONLY the scheduler (no web UI). Use this on a server/VPS
// if you want the 24/7 automation to run separately from the dashboard process.
import 'dotenv/config';
import scheduler from './scheduler.js';
import log from './log.js';

log.info('worker', 'starting headless scheduler');
scheduler.start();
