// Editorial calendar — turns "publish 2 posts a day at 09:00 and 14:00" into
// concrete future timestamps, spreading scheduled articles instead of dumping
// them all at once. Used when publish_cadence = 'scheduled': the pipeline asks
// for the next free slot(s) and schedules WordPress posts as `future`.
import db from '../db.js';
import cfg from '../config.js';

// Parse "09:00, 14:00" → [{h,m}], default a single 09:00 slot.
function slotTimes() {
  const raw = cfg.get('publish_times') || '09:00';
  const times = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
    .map((t) => { const [h, m] = t.split(':').map(Number); return { h: h || 0, m: m || 0 }; })
    .filter((t) => t.h >= 0 && t.h < 24 && t.m >= 0 && t.m < 60);
  return times.length ? times : [{ h: 9, m: 0 }];
}

const pad = (n) => String(n).padStart(2, '0');
// WordPress `date` is interpreted in the site's local timezone — send a naive
// ISO 8601 string (no Z) so it schedules at the intended wall-clock time.
function toWpDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

// All future slots already taken by scheduled articles (so we never collide).
function takenSlots() {
  const rows = db.prepare(
    "SELECT scheduled_for FROM articles WHERE status='scheduled' AND scheduled_for IS NOT NULL AND scheduled_for > datetime('now')"
  ).all();
  return new Set(rows.map((r) => r.scheduled_for.slice(0, 16))); // minute precision
}

// Return the next `count` free publish slots as WP date strings, starting from
// the next upcoming slot time after now. Caps at slotTimes().length per day.
export function nextSlots(count = 1, fromDate = new Date()) {
  const times = slotTimes();
  const taken = takenSlots();
  const out = [];
  // Start scanning from today; walk forward day by day, slot by slot.
  const cursor = new Date(fromDate);
  cursor.setSeconds(0, 0);
  for (let dayOffset = 0; out.length < count && dayOffset < 120; dayOffset++) {
    for (const t of times) {
      const slot = new Date(cursor);
      slot.setDate(cursor.getDate() + dayOffset);
      slot.setHours(t.h, t.m, 0, 0);
      if (slot <= fromDate) continue;           // must be in the future
      const key = toWpDate(slot).slice(0, 16);
      if (taken.has(key)) continue;             // already scheduled then
      out.push(toWpDate(slot));
      taken.add(key);
      if (out.length >= count) break;
    }
  }
  return out;
}

// Upcoming scheduled articles for the calendar view.
export function upcoming() {
  return db.prepare(
    `SELECT id, keyword, title, slug, status, scheduled_for, wp_url
     FROM articles
     WHERE status='scheduled' AND scheduled_for IS NOT NULL
     ORDER BY scheduled_for ASC`
  ).all();
}

export default { nextSlots, upcoming };
