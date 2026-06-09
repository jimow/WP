// Email delivery via Resend (https://resend.com) — a simple REST API for
// transactional email. Used for password-reset emails (and any future notices).
// Configure in Settings → Email (Resend) or via RESEND_API_KEY in .env.
//
// The "from" address must be on a domain you've verified in Resend. For quick
// testing Resend provides `onboarding@resend.dev`, which can only email YOUR own
// Resend account address — set a real verified sender for production.
import cfg from '../config.js';
import log from '../log.js';

export function configured() {
  return !!(cfg.get('resend_api_key') || '').trim();
}

function fromAddress() {
  const f = (cfg.get('resend_from') || '').trim();
  return f || 'WP Autopilot <onboarding@resend.dev>';
}

// Low-level send. `to` may be a string or array. Returns { id } on success.
export async function send({ to, subject, html, text, from, replyTo } = {}) {
  const key = (cfg.get('resend_api_key') || '').trim();
  if (!key) throw new Error('Resend is not connected — add your Resend API key in Settings → Email.');
  if (!to) throw new Error('No recipient.');
  const body = {
    from: from || fromAddress(),
    to: Array.isArray(to) ? to : [to],
    subject: subject || '(no subject)',
    html, text,
  };
  if (replyTo) body.reply_to = replyTo;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data.message || data.name || 'send failed'}`);
  log.info('resend', `Sent "${subject}" to ${Array.isArray(to) ? to.join(', ') : to} (id ${data.id || '?'})`);
  return data;
}

// Connectivity/config check — sends a tiny test message to `to`.
export async function test(to) {
  return send({
    to,
    subject: 'WP Autopilot — Resend test ✅',
    html: '<p>Your Resend email integration is working. 🎉</p>',
    text: 'Your Resend email integration is working.',
  });
}

// Branded password-reset email with the one-time link.
export async function sendPasswordReset(to, link, { name } = {}) {
  const safeLink = String(link);
  const html = `
  <div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#16202c">
    <div style="background:linear-gradient(135deg,#4f8cff,#7b5cff);border-radius:14px;padding:22px;text-align:center;color:#fff">
      <div style="font-size:20px;font-weight:800">WP Autopilot</div>
    </div>
    <div style="padding:24px 6px">
      <h2 style="margin:0 0 10px;font-size:20px">Reset your password</h2>
      <p style="color:#41505f;font-size:15px;line-height:1.6">Hi${name ? ' ' + name : ''}, we received a request to reset your WP Autopilot password. Click the button below to choose a new one. This link expires in <b>1 hour</b>.</p>
      <p style="text-align:center;margin:22px 0">
        <a href="${safeLink}" style="display:inline-block;background:#4f8cff;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px">Reset password →</a>
      </p>
      <p style="color:#64727f;font-size:13px;line-height:1.6">If the button doesn't work, paste this link into your browser:<br><a href="${safeLink}" style="color:#2f6fed;word-break:break-all">${safeLink}</a></p>
      <p style="color:#64727f;font-size:13px;line-height:1.6">If you didn't request this, you can safely ignore this email — your password won't change.</p>
    </div>
  </div>`;
  return send({ to, subject: 'Reset your WP Autopilot password', html, text: `Reset your WP Autopilot password (expires in 1 hour): ${safeLink}` });
}

export default { configured, send, test, sendPasswordReset };
