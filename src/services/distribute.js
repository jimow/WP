// Distribution & notifications via outbound webhooks. Rather than maintaining a
// fragile OAuth app per social network, we POST a clean JSON payload to a webhook
// the owner controls (Zapier / Make / Buffer / IFTTT / a Slack or Discord
// incoming webhook). That one hook can fan out to X, LinkedIn, Facebook, email,
// Slack — whatever they wire up. Two channels:
//   • share  → fired when a post goes live (for social/email amplification)
//   • notify → operational events (errors, decliners, approvals needed)
import cfg from '../config.js';
import log from '../log.js';

async function post(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
  return true;
}

// Announce a freshly published post to the share webhook (best-effort).
export async function onPublish({ title, url, excerpt = '', image = '' } = {}) {
  const hook = (cfg.get('share_webhook_url') || '').trim();
  if (!hook || !url) return { ok: false, skipped: true };
  try {
    // `text` is included so Slack/Discord incoming webhooks render something useful out of the box.
    await post(hook, {
      event: 'published', title, url, excerpt, image,
      text: `📝 New post published: ${title}\n${url}`,
      site: cfg.get('wp_base_url') || '', brand: cfg.get('brand_name') || '',
    });
    log.info('distribute', `Shared "${title}" to webhook`);
    return { ok: true };
  } catch (e) { log.warn('distribute', `share failed: ${e.message}`); return { ok: false, error: e.message }; }
}

// Operational notification (errors / decliners / approvals). `level`: info|warn|error.
export async function notify(event, message, { level = 'info', data = {} } = {}) {
  const hook = (cfg.get('notify_webhook_url') || '').trim();
  if (!hook) return { ok: false, skipped: true };
  if (level === 'error' && !cfg.getBool('notify_errors')) return { ok: false, skipped: true };
  try {
    const emoji = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : '🔵';
    await post(hook, { event, level, message, text: `${emoji} WP Autopilot — ${message}`, data, site: cfg.get('wp_base_url') || '' });
    return { ok: true };
  } catch (e) { log.warn('distribute', `notify failed: ${e.message}`); return { ok: false, error: e.message }; }
}

export function status() {
  return {
    share: !!(cfg.get('share_webhook_url') || '').trim(),
    notify: !!(cfg.get('notify_webhook_url') || '').trim(),
    notifyErrors: cfg.getBool('notify_errors'),
  };
}

export default { onPublish, notify, status };
