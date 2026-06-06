# WP Autopilot

A 24/7 autonomous SEO content agent for your **live WordPress site**. It runs as a
small Node.js service with a full web dashboard. It:

- 🔑 **Researches keywords** from the Ahrefs API (or manual entry)
- 🕸 **Plans hub-and-spoke** topic clusters with AI (one pillar + supporting spokes)
- 📝 **Writes SEO articles** as Gutenberg blocks with internal links, on a daily schedule
- 🎨 **Designs new pages** (hub/landing) and **redesigns existing page layouts**
- 📊 **Google Search Console**: live clicks/impressions/position, top queries & pages,
  AI recommendations, and one-click "striking-distance → article ideas"
- 🧩 **Themes & plugins**: list themes, list/activate/deactivate and install plugins
- 🩺 **Full WordPress management**: media/featured-image upload, site settings, comment
  moderation, users, trashing — plus a **diagnostics** probe that reports exactly which
  capabilities your connection has
- 🚀 **GSC → WordPress optimization engine**: scans Search Console for low-CTR pages,
  striking-distance pages, content gaps and cannibalization, then prepares AI fixes
  (title/meta rewrites, content refreshes) you approve and push live — with optional
  scheduler automation. Includes URL index-status checks and AI featured-image generation.
- ✅ **Draft → approve → publish** workflow (you stay in control), pushed over the WP REST API
- 🌗 **Light / dark mode** dashboard
- ⚙️ A complete **GUI** for settings, manual entry, and automation control

## Architecture

```
Dashboard (browser)  ──>  Express API  ──>  services  ──>  WordPress REST
                                          ├─ Ahrefs API (keywords)
                                          └─ Claude / OpenAI (writing & design)
node-cron scheduler  ──>  pipeline.tick()  (the "24/7" heartbeat)
SQLite (data/autopilot.db)  holds settings, keywords, clusters, articles, pages, logs
```

## Setup

1. **Install deps**
   ```powershell
   npm install
   ```
2. **Configure** — copy `.env.example` to `.env` and fill what you like, OR just start
   the app and enter everything in **Settings**. You'll need:
   - WordPress: site URL, a username, and an **Application Password**
     (WP Admin → Users → Profile → *Application Passwords*).
   - Ahrefs API token (https://ahrefs.com/api).
   - An AI key: Anthropic **or** OpenAI.
3. **Run**
   ```powershell
   npm start
   ```
   Open **http://localhost:4317**.

## Daily workflow

1. **Settings** → fill connections + brand/niche, hit *Test* on each.
2. **Keywords** → research a seed (Ahrefs) → *Plan hub & spoke*.
3. **Hub & Spoke** → review clusters, optionally *Design hub page*.
4. **Articles** → *Generate* drafts → *Review* → *Approve & publish*.
5. Flip **Automation on** (top-left) to let the scheduler generate drafts daily.

### Autonomy modes (Settings → Automation)
- **Draft → approve** *(default, safest)*: agent only drafts; you approve before publishing.
- **Auto-publish articles only**: articles publish on schedule; pages still need approval.
- **Full auto**: articles publish automatically; pages you still trigger from the UI.

## Running it truly 24/7

Keep this PC on, **or** deploy the folder to a small VPS and run:
```bash
npm install --omit=dev
node src/server.js        # dashboard + scheduler
# or, headless scheduler only:
node src/worker.js
```
Use `pm2` or a systemd service to keep it alive and restart on boot.

## Notes / safety
- All AI output is editable in the GUI before it goes live.
- Secrets are stored locally in `data/autopilot.db` (gitignored). Set `DASHBOARD_PASSWORD`
  in `.env` if you expose the dashboard beyond localhost.
- Ahrefs response shapes vary by plan; the client normalises defensively and falls back
  to manual keywords if an endpoint isn't available on your plan.
