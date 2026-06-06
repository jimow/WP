// Tiny logger that writes to both the console and the logs table so the
// dashboard can show a live activity feed.
import db from './db.js';

const insert = db.prepare('INSERT INTO logs(level, area, message) VALUES(?, ?, ?)');

function write(level, area, ...parts) {
  const message = parts
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  try {
    insert.run(level, area, message);
  } catch {
    /* ignore logging failures */
  }
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${area}: ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (area, ...m) => write('debug', area, ...m),
  info: (area, ...m) => write('info', area, ...m),
  warn: (area, ...m) => write('warn', area, ...m),
  error: (area, ...m) => write('error', area, ...m),
};

export default log;
