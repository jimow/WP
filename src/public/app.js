// WP Autopilot dashboard — vanilla JS SPA.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- Top progress bar — auto-driven by every API request -----------------
let _pending = 0;
function progStart() {
  _pending++;
  const p = $('#progress'); if (!p) return;
  p.classList.add('active');
  p.style.width = Math.min(85, 16 + _pending * 10 + Math.random() * 18) + '%';
}
function progDone() {
  _pending = Math.max(0, _pending - 1);
  const p = $('#progress'); if (!p) return;
  if (_pending === 0) { p.style.width = '100%'; setTimeout(() => { p.classList.remove('active'); p.style.width = '0'; }, 280); }
  else p.style.width = Math.min(90, 28 + _pending * 10) + '%';
}

const api = {
  async req(method, path, body) {
    progStart();
    try {
      const res = await fetch('/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.authRequired) { location.href = '/'; throw new Error('Sign in required'); }
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    } finally { progDone(); }
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
  put: (p, b) => api.req('PUT', p, b),
  del: (p) => api.req('DELETE', p),
};

// Toast with an icon. type: '' | success | error | loading. A 'loading' toast
// persists (no auto-dismiss) until another toast() call replaces it. Returns a
// small handle so callers can do: const t = toast('Working…','loading'); t.done('Saved').
const TOAST_ICONS = { success: '✅', error: '⚠️', info: '💡', '': '💡' };
function toast(msg, type = '') {
  const t = $('#toast');
  const ico = type === 'loading' ? '<span class="spinner"></span>' : (TOAST_ICONS[type] || '💡');
  t.innerHTML = `<span class="t-ico">${ico}</span><span>${esc(msg)}</span>`;
  t.className = `toast show ${type}`;
  clearTimeout(t._timer);
  if (type !== 'loading') t._timer = setTimeout(() => { t.className = 'toast'; }, 3600);
  return {
    done: (m, tp = 'success') => toast(m, tp),
    fail: (m) => toast(m, 'error'),
    hide: () => { clearTimeout(t._timer); t.className = 'toast'; },
  };
}
function modal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); const m = $('#modal .modal'); if (m) m.classList.remove('preview-modal'); }
$('#modalClose').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

// Put a button into a spinner/disabled state for the duration of an async action.
async function withBtn(btn, fn) {
  if (!btn) return fn();
  btn.classList.add('loading'); btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove('loading'); btn.disabled = false; }
}

const badge = (s) => `<span class="badge ${s}">${esc(String(s).replace(/_/g, ' '))}</span>`;
const seoPill = (n) => (n == null ? '<span class="muted">–</span>'
  : `<span class="badge ${n >= 80 ? 'published' : n >= 50 ? 'pending_review' : 'failed'}">${n}</span>`);

// Reusable pagination control. fnName is a global fn taking the new page number.
function pager(meta, fnName) {
  if (!meta) return '';
  const total = meta.total || 0, pages = meta.totalPages || 1, cur = meta.page || 1;
  if (pages <= 1) return total ? `<div class="pager"><span class="muted">${total} item${total === 1 ? '' : 's'}</span></div>` : '';
  // Windowed page numbers: 1 … (cur-1, cur, cur+1) … last
  const nums = new Set([1, pages, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
  const list = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  let cells = '', prev = 0;
  for (const n of list) {
    if (n - prev > 1) cells += '<span class="pg-ell">…</span>';
    cells += `<button class="pg ${n === cur ? 'on' : ''}" onclick="${fnName}(${n})">${n}</button>`;
    prev = n;
  }
  return `<div class="pager">
    <button class="pg" ${cur <= 1 ? 'disabled' : ''} onclick="${fnName}(1)" title="First">«</button>
    <button class="pg" ${cur <= 1 ? 'disabled' : ''} onclick="${fnName}(${cur - 1})" title="Previous">‹</button>
    ${cells}
    <button class="pg" ${cur >= pages ? 'disabled' : ''} onclick="${fnName}(${cur + 1})" title="Next">›</button>
    <button class="pg" ${cur >= pages ? 'disabled' : ''} onclick="${fnName}(${pages})" title="Last">»</button>
    <span class="muted" style="margin-left:8px;font-size:12px">${total} items</span>
    <input class="pg-jump" type="number" min="1" max="${pages}" placeholder="${cur}" title="Jump to page" onkeydown="if(event.key==='Enter'){const v=Math.max(1,Math.min(${pages},+this.value||1));${fnName}(v);}"/>
  </div>`;
}
// The content lifecycle "flow" strip — the SAME pipeline shown on Workflow,
// Hub & Spoke, Content and WordPress so users see they're stages of ONE journey,
// not separate tools. `active` highlights the current stage; each is clickable.
function pipelineFlow(active) {
  const stages = [
    { key: 'clusters', n: '1', icon: '🕸', label: 'Plan', desc: 'Topic clusters (Hub & Spoke)' },
    { key: 'workflow', n: '2', icon: '✍️', label: 'Create', desc: 'Generate the articles' },
    { key: 'articles', n: '3', icon: '📝', label: 'Review', desc: 'Drafts in Content' },
    { key: 'site', n: '4', icon: '🧩', label: 'Publish', desc: 'Live on WordPress' },
    { key: 'indexstatus', n: '5', icon: '📈', label: 'Grow', desc: 'Track & improve' },
  ];
  return `<div class="card flow-card">
    <div class="flow">${stages.map((s, i) => `
      <button class="flow-step ${active === s.key ? 'on' : ''}" onclick="navigate('${s.key}')" title="Go to ${s.label}">
        <div class="flow-n">STEP ${s.n}</div><div class="flow-ic">${s.icon}</div><div class="flow-lbl">${s.label}</div><div class="flow-desc">${s.desc}</div>
      </button>${i < stages.length - 1 ? '<div class="flow-arrow">→</div>' : ''}`).join('')}
    </div>
    <p class="hint" style="margin:10px 2px 0">It's <b>one journey</b>: a keyword becomes a <b>cluster</b> (Hub &amp; Spoke) → each topic is generated into an <b>article</b> (Content) → which publishes to <b>WordPress</b> → then you <b>track &amp; improve</b> it. Same content, different stage — you're ${active === 'clusters' ? 'planning' : active === 'workflow' ? 'creating' : active === 'articles' ? 'reviewing drafts' : active === 'site' ? 'managing what\'s live' : 'growing'} right now.</p>
  </div>`;
}
// Dropdown action menu.
function actionMenu(items) {
  return `<div class="menu-wrap"><button class="btn sm secondary" onclick="toggleMenu(this)">⋯</button>
    <div class="menu" style="display:none">${items.map((i) => i === '-' ? '<div class="sep"></div>' : `<button class="${i.danger ? 'danger' : ''}" onclick="closeMenus();${i.onclick}">${i.label}</button>`).join('')}</div></div>`;
}
window.toggleMenu = (btn) => {
  const menu = btn.nextElementSibling;
  const open = menu.style.display === 'block';
  closeMenus();
  menu.style.display = open ? 'none' : 'block';
};
window.closeMenus = () => $$('.menu').forEach((m) => (m.style.display = 'none'));
document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) closeMenus(); });

// ---- Router ---------------------------------------------------------------
const views = {};
let current = 'dashboard';
const titles = { dashboard: 'Dashboard', workflow: 'Content Workflow', strategy: 'SEO Strategy', keywords: 'Keywords', clusters: 'Hub & Spoke',
  articles: 'Content', article: 'Article Editor', pages: 'Pages & Layout', stats: 'Content Stats',
  searchconsole: 'Search Console', indexstatus: 'Pages — Index & Performance', optimize: 'Opportunities', site: 'WordPress',
  ahrefs: 'Ahrefs — Keywords, Competitors & Backlinks',
  autopilot: 'Autopilot — 24/7 Engine', settings: 'Settings', logs: 'Activity' };

// One-line "what this does + what to expect" guidance shown under each title.
const viewIntro = {
  dashboard: 'Your control room — connections, today’s output, and the last automation run at a glance.',
  workflow: 'The guided way to create or improve content, step by step. Start here.',
  articles: 'Every article — ideas, drafts, scheduled and published. Generate, review, and publish from here.',
  article: 'Edit the draft, watch the live Rank Math score, and publish when it’s ready.',
  clusters: 'Hub-and-spoke topic clusters — a pillar page linked to supporting articles for topical authority.',
  strategy: 'A brief audit of your site plus the highest-leverage next moves. Acting on these opens the Workflow.',
  autopilot: 'The 24/7 engine — idea queue, editorial calendar, rank tracking, indexing and distribution.',
  searchconsole: 'Live Google Search Console performance and the opportunities it surfaces.',
  indexstatus: 'Your existing pages, split into indexed vs not-indexed — performance, easy wins, and how each moved since it was optimized. The 24/7 worker fills this from Search Console.',
  ahrefs: 'Ahrefs powers keyword research, competitor SERP analysis, backlinks, referring domains and domain metrics — for any site, including competitors.',
  stats: 'Production and performance over time — what you’ve published and how it’s doing.',
  site: 'Browse and manage your live WordPress — posts, pages, media and comments.',
  pages: 'Design complete, theme-native pages with AI — preview, drag-and-drop, or replicate a design.',
  settings: 'Every behaviour is yours to control. Nothing runs unless you switch it on here.',
  logs: 'A live feed of what the agent is doing behind the scenes.',
};
function viewSkeleton() {
  const card = '<div class="card"><div class="skeleton skel-stat"></div><div class="skeleton skel-line lg"></div><div class="skeleton skel-line md"></div></div>';
  return `<div class="grid cols-3">${card.repeat(3)}</div>
    <div class="card" style="margin-top:16px">
      <div class="skeleton skel-line md"></div><div class="skeleton skel-line lg"></div>
      <div class="skeleton skel-line lg"></div><div class="skeleton skel-line sm"></div></div>`;
}
function navigate(view) {
  current = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#viewTitle').textContent = titles[view] || view;
  const sub = $('#viewSubtitle'); if (sub) sub.textContent = viewIntro[view] || '';
  // Instant skeleton so navigation never shows a blank flash; the view replaces it.
  $('#view').innerHTML = viewSkeleton();
  try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch { window.scrollTo(0, 0); }
  Promise.resolve()
    .then(() => views[view]())
    .catch((e) => { $('#view').innerHTML = `<div class="callout warn"><span class="ico">⚠️</span><div><b>Could not load this view.</b><br><span class="muted">${esc(e.message)}</span></div></div>`; })
    .finally(() => { if (typeof updateGenPill === 'function') updateGenPill(); });
}
$$('.nav-item').forEach((b) => (b.onclick = () => navigate(b.dataset.view)));

// ---- Dashboard ------------------------------------------------------------
views.dashboard = async () => {
  $('#view').innerHTML = '<div class="empty"><span class="spinner"></span> Loading…</div>';
  const s = await api.get('/status');
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const card = (title, val, sub) => `<div class="card"><h3>${title}</h3><div class="stat">${val}</div><div class="stat-sub">${sub || ''}</div></div>`;
  const conn = (ok) => ok ? '<span class="badge published">connected</span>' : '<span class="badge failed">not set</span>';
  const last = s.lastRun?.summary;

  $('#view').innerHTML = `
    <div class="grid cols-4">
      ${card('Published today', s.publishedToday, `daily target: ${s.articles_per_day}`)}
      ${card('Articles', sum(s.articles), `${s.articles.pending_review || 0} awaiting review`)}
      ${card('Clusters', s.clusters, 'hub & spoke topics')}
      ${card('Keywords', sum(s.keywords), `${s.keywords.new || 0} unclustered`)}
    </div>
    <div class="grid cols-3" style="margin-top:16px">
      <div class="card"><h3>WordPress</h3>${conn(s.connections.wordpress)}<div class="stat-sub" style="margin-top:8px"><button class="btn sm secondary" onclick="testConn('wordpress')">Test</button> <button class="btn sm" onclick="wpDiagnostics()">Diagnostics</button></div></div>
      <div class="card"><h3>Ahrefs</h3>${conn(s.connections.ahrefs)}
        <p class="stat-sub" style="margin-top:6px">Keywords · competitors · backlinks · domain metrics</p>
        <div class="stat-sub" style="margin-top:8px"><button class="btn sm secondary" onclick="testConn('ahrefs')">Test</button> <button class="btn sm" onclick="navigate('ahrefs')">Open 🔗</button></div></div>
      <div class="card"><h3>AI writer</h3>${conn(s.connections.ai)}<div class="stat-sub" style="margin-top:8px"><button class="btn sm secondary" onclick="testConn('ai')">Test</button></div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Automation</h3>
      <p class="muted">Mode: <b>${esc(s.autonomy.replace(/_/g, ' '))}</b> · schedule <code>${esc(s.tick_cron)}</code> · ${s.automation_enabled ? '<span class="badge published">running</span>' : '<span class="badge failed">paused</span>'}</p>
      ${last ? `<p class="muted">Last run:${last.replenished ? ` +${last.replenished} ideas,` : ''} +${last.generated} drafts, +${last.published} published${last.scheduled ? `, +${last.scheduled} scheduled` : ''}${last.refreshed ? `, ${last.refreshed} refreshed` : ''}${last.errors?.length ? `, ${last.errors.length} errors` : ''}</p>` : '<p class="muted">No runs yet.</p>'}
      <div class="inline" style="margin-top:8px">
        <button class="btn" onclick="runNow()">⚡ Run pipeline now</button>
        <button class="btn secondary" onclick="navigate('autopilot')">🤖 Autopilot</button>
        <button class="btn secondary" onclick="navigate('articles')">Review queue</button>
      </div>
    </div>`;
};
window.testConn = async (which) => {
  toast(`Testing ${which}…`);
  try {
    const r = await api.post('/test/' + which);
    toast(`${which}: OK ${r.user ? '(' + r.user + ')' : r.reply ? '(' + r.reply + ')' : ''}`, 'success');
  } catch (e) { toast(`${which}: ${e.message}`, 'error'); }
};
window.wpDiagnostics = async () => {
  modal('WordPress diagnostics', '<div class="empty"><span class="spinner"></span> Probing your site…</div>');
  let d;
  try { d = await api.get('/wp/diagnostics'); }
  catch (e) { $('#modalBody').innerHTML = `<p class="badge failed">${esc(e.message)}</p><p class="muted">Add your site URL, username and Application Password in Settings, then retry.</p>`; return; }
  const yn = (b) => b ? '✅' : '⚠️';
  const site = d.site ? `<p class="muted" style="font-size:13px"><b>${esc(d.site.title || '')}</b> — ${esc(d.site.tagline || '')}<br>${esc(d.site.url || '')} · ${esc(d.site.language || '')} · ${esc(d.site.timezone || '')}</p>` : '';
  const counts = Object.entries(d.counts || {}).map(([k, v]) => `<span class="badge" style="margin:2px">${v} ${k}</span>`).join('');
  $('#modalBody').innerHTML = `
    <div class="section-head" style="margin-bottom:6px"><h2 style="font-size:15px">Connected as ${esc(d.identity?.name || '')} <span class="muted">(${(d.identity?.roles || []).join(', ')})</span></h2>
      ${d.summary?.canPublish ? '<span class="badge published">can publish</span>' : '<span class="badge failed">cannot publish</span>'}</div>
    ${site}
    <p style="margin:6px 0">${counts}</p>
    ${d.seo ? `<p class="muted" style="font-size:13px">SEO plugin — Rank Math: ${d.seo.rankMath ? badge(d.seo.rankMath === 'active' ? 'published' : 'pending_review') : '<span class="badge failed">not found</span>'} ${d.seo.yoast ? ` · Yoast: ${esc(d.seo.yoast)}` : ''}</p>` : ''}
    ${d.warnings?.length ? `<div class="card" style="background:var(--bg);border-color:var(--warn)">${d.warnings.map((w) => `<div style="font-size:13px">⚠️ ${esc(w)}</div>`).join('')}</div>` : ''}
    <div class="grid cols-2" style="margin-top:12px">
      <div><h3 style="font-size:13px;color:var(--muted)">Capabilities (${d.summary?.capabilities})</h3>
        ${d.capabilities.map((c) => `<div style="font-size:13px;margin:3px 0">${yn(c.has)} ${esc(c.label)}</div>`).join('')}</div>
      <div><h3 style="font-size:13px;color:var(--muted)">Endpoints (${d.summary?.endpointsOk}/${d.summary?.endpointsTotal})</h3>
        ${d.endpoints.map((e) => `<div style="font-size:13px;margin:3px 0" title="${esc(e.error || '')}">${yn(e.ok)} ${esc(e.label)}${e.ok ? '' : ' <span class="muted">— blocked</span>'}</div>`).join('')}</div>
    </div>`;
};

// ===========================================================================
// Content Workflow — a guided, step-by-step wizard. Two clear paths:
//   A) Improve an existing article (its GSC analysis → refresh / links / spokes)
//   B) Create new content (focus keyword → hub & spoke best practice → generate)
// ===========================================================================
// Wizard state persists across navigation AND page reloads (nothing discarded).
let wf = (() => { try { return JSON.parse(localStorage.getItem('wpap-wf')) || { mode: null, step: 1, data: {} }; } catch { return { mode: null, step: 1, data: {} }; } })();
let wfKwTab = 'type';
function saveWf() { try { localStorage.setItem('wpap-wf', JSON.stringify(wf)); } catch { /* quota */ } }
views.workflow = () => renderWf();
window.wfStart = (mode) => { wf = { mode, step: 1, data: { keywords: [], structure: null } }; renderWf(); };
window.wfReset = () => { wf = { mode: null, step: 1, data: {} }; renderWf(); };
window.wfGo = (step) => { wf.step = step; renderWf(); };
// Integration entry points — every "create/plan" button across the app funnels here.
window.goWorkflowCreate = (keywords = []) => {
  const k = [...new Set((keywords || []).filter(Boolean))];
  wf = { mode: 'create', step: k.length ? 2 : 1, data: { keywords: k, structure: null } };
  wfKwTab = 'type';
  navigate('workflow');
};
window.goWorkflowImprove = (url) => { wf = { mode: 'improve', step: url ? 2 : 1, data: { url } }; navigate('workflow'); };

function wfShell(title, stepNames, body) {
  const steps = stepNames.map((s, i) => `<span class="subtab ${wf.step === i + 1 ? 'active' : ''}" style="cursor:default">${i + 1}. ${esc(s)}</span>`).join('');
  return `<div class="card"><div class="section-head"><h2>${title}</h2><button class="btn sm ghost" onclick="wfReset()">↺ Start over</button></div>
    <div class="subtabs">${steps}</div>${body}</div>`;
}
function renderWf() {
  saveWf();
  if (!wf.mode) return renderWfHome();
  if (wf.mode === 'improve') return renderImprove();
  return renderCreate();
}
async function renderWfHome() {
  $('#view').innerHTML = '<div class="empty"><span class="spinner"></span> Loading…</div>';
  const [arts, st] = await Promise.all([api.get('/articles').catch(() => []), api.get('/status').catch(() => null)]);
  const pending = arts.filter((a) => ['idea', 'generating', 'pending_review', 'approved', 'failed'].includes(a.status));
  const c = (st && st.connections) || {};
  const dot = (ok, label) => `<span class="badge ${ok ? 'published' : 'failed'}">${label}</span>`;
  const row = (a) => `<tr>
    <td>${a.title ? `<b>${esc(a.title)}</b><br><span class="muted" style="font-size:11px">${esc(a.keyword)}</span>` : esc(a.keyword)}${a.error ? `<br><span class="badge failed">${esc(a.error.slice(0, 50))}</span>` : ''}${a.kw_warning ? `<br><span class="badge failed" title="${esc(a.kw_warning)}">⚠ duplicate keyword — confirm</span>` : ''}</td>
    <td>${seoPill(a.seo_score)}</td><td>${badge(a.status)}</td>
    <td class="row-actions">
      ${a.status === 'idea' || a.status === 'failed' ? `<button class="btn sm" onclick="generateOne(${a.id},'workflow')">Generate</button>` : a.status === 'generating' ? `<button class="btn sm" onclick="viewGen(${a.id})"><span class="spinner"></span> Progress</button>` : `<button class="btn sm secondary" onclick="openArticle(${a.id},{from:'workflow'})">Open</button>`}
      ${a.status === 'pending_review' ? `<button class="btn sm success" onclick="approveArticle(${a.id})">Approve &amp; publish</button>` : ''}
      ${a.status === 'approved' ? `<button class="btn sm success" onclick="publishArticle(${a.id})">Publish</button>` : ''}
    </td></tr>`;
  $('#view').innerHTML = `
    ${pipelineFlow('workflow')}
    <div class="card">
      <h2>Start here — what do you want to do?</h2>
      <p class="hint">One straightforward flow. Connections: ${dot(c.wordpress, 'WordPress')} ${dot(c.ai, 'AI')} ${dot(c.gsc, 'Search Console')}</p>
      <div class="grid cols-2">
        <div class="card"><h3>✍️ Create new content</h3>
          <p class="muted">Focus keyword (auto-suggest / type / paste) → single article or hub &amp; spoke (best practice, duplicate-guarded) → generate.</p>
          <button class="btn" onclick="wfStart('create')">Create →</button></div>
        <div class="card"><h3>📈 Improve an existing article</h3>
          <p class="muted">Use its Search Console data to refresh content, add internal links, add spokes, or make it a hub.</p>
          <button class="btn" onclick="wfStart('improve')">Improve →</button></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head"><h2>📋 Your pending work (${pending.length})</h2><button class="btn sm secondary" onclick="renderWf()">Refresh</button></div>
      <p class="hint">Everything in progress is saved here — pick up where you left off anytime. Nothing is discarded.</p>
      ${pending.length
        ? `<table><thead><tr><th>Article</th><th>SEO</th><th>Status</th><th></th></tr></thead><tbody>${pending.map(row).join('')}</tbody></table>`
        : '<div class="empty">Nothing pending. Create content above to get started.</div>'}
    </div>`;
}

// ---- Path A: Improve existing --------------------------------------------
function renderImprove() {
  const steps = ['Pick a page', 'Analyse & act'];
  if (wf.step === 1) {
    $('#view').innerHTML = wfShell('📈 Improve existing', steps, `
      <p class="hint">Scan Search Console for the highest-impact pages, or paste a post URL.</p>
      <div class="inline"><button class="btn" onclick="wfScan()">🔄 Scan Search Console</button>
        <input id="wf_url" placeholder="…or paste a post URL" style="flex:1;min-width:220px"/>
        <button class="btn secondary" onclick="wfPickUrl()">Use URL →</button></div>
      <div id="wfScan" style="margin-top:12px"></div>`);
    return;
  }
  // step 2
  const url = wf.data.url;
  $('#view').innerHTML = wfShell('📈 Improve existing', steps, `
    <p style="font-size:13px">Page: <a href="${esc(url)}" target="_blank">${esc(url)}</a> <button class="btn sm ghost" onclick="wfGo(1)">change</button></p>
    <div class="inline" style="flex-wrap:wrap">
      <button class="btn" onclick="wfAnalyze()">🔬 Analyse (gaps, hub, links, backlinks)</button>
      <button class="btn secondary" onclick="wfImprove('refresh')">📈 Refresh content</button>
      <button class="btn secondary" onclick="wfImprove('ctr')">🎯 Improve CTR</button>
    </div>
    <div id="wfIntel" style="margin-top:12px"></div>`);
}
window.wfScan = async () => {
  const el = $('#wfScan'); el.innerHTML = '<div class="empty"><span class="spinner"></span> Scanning…</div>';
  try {
    const d = await api.post('/optimize/scan', { days: 28 });
    const items = (d.opportunities || []).filter((o) => o.type === 'refresh' || o.type === 'ctr').slice(0, 15);
    el.innerHTML = items.length ? `<table><thead><tr><th>Page</th><th>Type</th><th>Impr</th><th>Pos</th><th></th></tr></thead><tbody>
      ${items.map((o) => `<tr><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(o.url)}</td><td>${o.type === 'ctr' ? '🎯 CTR' : '📈 Refresh'}</td><td>${o.impressions ?? '–'}</td><td>${o.position ?? '–'}</td>
        <td><button class="btn sm" onclick="wfSelectPage('${encodeURIComponent(o.url)}')">Select →</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No opportunities found.</div>';
  } catch (e) { el.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; }
};
window.wfSelectPage = (u) => { wf.data.url = decodeURIComponent(u); wf.step = 2; renderWf(); };
window.wfPickUrl = () => { const u = $('#wf_url').value.trim(); if (!u) return toast('Enter a URL', 'error'); wf.data.url = u; wf.step = 2; renderWf(); };
window.wfImprove = async (mode) => {
  const el = $('#wfIntel'); el.innerHTML = `<div class="empty"><span class="spinner"></span> Preparing ${mode === 'ctr' ? 'a higher-CTR title & meta' : 'a content refresh'}…</div>`;
  try {
    const o = await api.post('/optimize/' + mode, { url: wf.data.url });
    el.innerHTML = `<div class="bulkbar" style="border-color:var(--accent-2)"><b>Prepared ${mode === 'ctr' ? 'CTR rewrite' : 'content refresh'}.</b> Review it and apply — all here.
      <button class="btn sm secondary" onclick="viewOpt(${o.id})">Review diff</button>
      <button class="btn sm success" onclick="applyOpt(${o.id})">Apply to WordPress</button></div>`;
    toast('Prepared', 'success');
  } catch (e) { el.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; }
};
window.wfAnalyze = async () => {
  const el = $('#wfIntel'); el.innerHTML = '<div class="empty"><span class="spinner"></span> Analysing the SERP &amp; your content…</div>';
  let d;
  try { d = await api.post('/intel/analyze', { url: wf.data.url }); }
  catch (e) { el.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; return; }
  wf.data.intel = d;
  const hp = d.hubPotential || {};
  el.innerHTML = `<div class="grid cols-2" style="align-items:start">
      <div><h3>🧩 Content gaps to add</h3>${(d.contentGaps || []).map((g) => `<div style="font-size:13px">• ${esc(g)}</div>`).join('') || '<p class="muted">None.</p>'}
        <h3 style="margin-top:10px">💡 Beat them</h3>${(d.competitorsLack || []).map((g) => `<div style="font-size:13px">• ${esc(g)}</div>`).join('') || '<p class="muted">—</p>'}</div>
      <div><h3>🏛 Make it a hub?</h3>
        ${hp.canBeHub ? `<p style="font-size:13px"><span class="badge approved">Yes</span> ${esc(hp.reason || '')}</p>
          ${(hp.suggestedSpokes || []).length ? `<p style="font-size:13px">Spokes: ${hp.suggestedSpokes.map((s) => `<span class="badge" style="margin:2px">${esc(s)}</span>`).join('')}</p>
          <button class="btn sm success" onclick="wfCreateSpokes()">➕ Create these ${hp.suggestedSpokes.length} spokes (+ make hub)</button>` : ''}`
          : `<p class="muted" style="font-size:13px">${esc(hp.reason || 'Keep as a single article.')}</p>`}</div>
    </div>
    <h3 style="margin-top:12px">🔗 Internal links to insert</h3>
    ${(d.internalLinks || []).length ? `${d.internalLinks.map((l, i) => `<label class="field" style="display:flex;flex-direction:row;gap:8px;align-items:center;margin-bottom:3px"><input type="checkbox" class="wf_il" data-i="${i}" style="width:auto" checked/><span style="margin:0;font-size:13px"><b>${esc(l.anchor || '')}</b> → ${esc(l.toTitle || l.toUrl)}</span></label>`).join('')}
      <button class="btn sm success" onclick="wfInsertLinks()">Insert into the post</button>` : '<p class="muted">No internal-link opportunities found.</p>'}
    <h3 style="margin-top:12px">🪝 Backlink steps</h3>
    ${(d.backlinkSteps || []).map((b) => `<div style="font-size:13px;padding:4px 0;border-bottom:1px solid var(--border)"><b>${esc(b.tactic || '')}</b> — ${esc(b.step || '')} <span class="muted">(${esc(b.target || '')})</span></div>`).join('') || '<p class="muted">—</p>'}`;
};
window.wfCreateSpokes = async () => {
  const intel = wf.data.intel; const spokes = intel?.hubPotential?.suggestedSpokes || [];
  if (!spokes.length) return;
  try { await api.post('/clusters/create', { clusters: [{ name: `${intel.keyword} (hub)`, hub_keyword: intel.keyword, spokes }] });
    toast(`Created hub + ${spokes.length} spoke article ideas — find them in Hub & Spoke / pipeline`, 'success'); }
  catch (e) { toast(e.message, 'error'); }
};
window.wfInsertLinks = async () => {
  const picks = $$('.wf_il').filter((c) => c.checked).map((c) => wf.data.intel.internalLinks[+c.dataset.i]);
  if (!picks.length) return toast('Select at least one', 'error');
  try { const r = await api.post('/intel/insert-links', { url: wf.data.url, links: picks }); toast(`Inserted ${r.total} link(s) into the live post`, 'success'); }
  catch (e) { toast(e.message, 'error'); }
};

// ---- Path B: Create new ---------------------------------------------------
function renderCreate() {
  const steps = ['Focus keyword', 'Structure', 'Options', 'Generate'];
  const chips = (wf.data.keywords || []).map((k, i) => `<span class="badge approved" style="margin:2px">${esc(k)} <a href="#" onclick="wfDelKw(${i});return false" style="color:inherit">✕</a></span>`).join('');
  if (wf.step === 1) {
    const tabBody = wfKwTab === 'auto'
      ? `<button class="btn" onclick="wfKwAuto()">🔎 Find keyword opportunities (Search Console)</button><div id="wfKwAuto" style="margin-top:10px"></div>`
      : wfKwTab === 'paste'
        ? `<label class="field"><span>Paste keywords (one per line)</span><textarea id="wf_paste" style="min-height:100px" placeholder="matrix multiplication&#10;eigenvalues and eigenvectors"></textarea></label><button class="btn secondary" onclick="wfKwPaste()">Add all</button>`
        : `<div class="inline"><input id="wf_type" placeholder="type a focus keyword" style="flex:1" onkeydown="if(event.key==='Enter')wfKwType()"/><button class="btn secondary" onclick="wfKwType()">Add</button></div>`;
    $('#view').innerHTML = wfShell('✍️ Create new content', steps, `
      <div class="tabs">${[['auto', '🔎 Auto-suggest'], ['type', '⌨️ Type'], ['paste', '📋 Paste list']].map(([t, l]) => `<div class="tab ${wfKwTab === t ? 'active' : ''}" onclick="wfKwTabSet('${t}')">${l}</div>`).join('')}</div>
      ${tabBody}
      <p class="hint" style="margin-top:8px">🛡 Duplicate guard active — <span id="wfIdx" class="muted">checking…</span>. <a href="#" onclick="wfRebuildIdx();return false">refresh from site</a></p>
      <div style="margin-top:12px">${chips ? `<b style="font-size:12px">Chosen:</b> ${chips}` : '<span class="muted">No keywords chosen yet.</span>'}</div>
      ${wf.data.dupes && wf.data.dupes.length ? `<div class="bulkbar" style="border-color:var(--warn)"><div>
        <b>⚠ ${wf.data.dupes.length} already covered</b> — these would cannibalise an existing page:
        <ul style="margin:4px 0">${wf.data.dupes.map((d) => `<li style="font-size:12px">${esc(d.keyword)} ${d.match.url ? `→ <a href="${esc(d.match.url)}" target="_blank">existing post</a>` : `(${esc(d.match.source)})`} ${d.kind === 'fuzzy' ? '<span class="badge">similar</span>' : ''}</li>`).join('')}</ul>
        <button class="btn sm success" onclick="wfRemoveCovered()">Remove covered &amp; continue →</button>
        <button class="btn sm ghost" onclick="wfKeepAll()">Create all anyway</button></div></div>` : ''}
      <div class="inline" style="margin-top:12px"><button class="btn" onclick="wfKwNext()">Next: structure →</button></div>`);
    loadIdxStatus();
    return;
  }
  if (wf.step === 2) {
    $('#view').innerHTML = wfShell('✍️ Create new content', steps, `
      <p class="hint"><b>Hub &amp; spoke best practice:</b> one pillar/hub covers the topic broadly; spokes are focused supporting articles that link back up to the hub, and the hub links down to each spoke.</p>
      <div class="grid cols-2">
        <div class="card"><h3>📄 Single article(s)</h3><p class="muted">One article per keyword. Good for standalone posts.</p>
          <button class="btn ${wf.data.structure === 'single' ? 'success' : 'secondary'}" onclick="wfStructure('single')">${wf.data.structure === 'single' ? '✓ Chosen' : 'Choose'}</button></div>
        <div class="card"><h3>🕸 Hub &amp; spoke cluster</h3><p class="muted">A pillar + supporting spokes with interlinking. Best for owning a topic.</p>
          <button class="btn ${wf.data.structure === 'hubspoke' ? 'success' : 'secondary'}" onclick="wfStructure('hubspoke')">${wf.data.structure === 'hubspoke' ? '✓ Chosen' : 'Choose'}</button></div>
      </div>
      <div id="wfProposed" style="margin-top:12px"></div>
      <div class="inline" style="margin-top:12px"><button class="btn ghost" onclick="wfGo(1)">← Back</button>
        <button class="btn" onclick="wfGo(3)" ${wf.data.structure ? '' : 'disabled'}>Next: options →</button></div>`);
    if (wf.data.structure === 'hubspoke') renderProposed();
    return;
  }
  if (wf.step === 3) {
    const s = window.__wfSettings || {};
    $('#view').innerHTML = wfShell('✍️ Create new content', steps, `
      <p class="hint">Generation options (override your defaults for this batch). Drafts are created for review — nothing publishes automatically.</p>
      <div class="grid cols-2">
        <label class="field"><span>Target words (min)</span><input id="wo_wmin" type="number" value="${esc(s.words_min || '')}"/></label>
        <label class="field"><span>Target words (max)</span><input id="wo_wmax" type="number" value="${esc(s.words_max || '')}"/></label>
      </div>
      <label class="field"><span>Tone</span><input id="wo_tone" value="${esc(s.tone || '')}"/></label>
      <label class="field"><span>Angle / intent (optional)</span><input id="wo_angle" placeholder="e.g. beginner tutorial with worked numpy example"/></label>
      <label class="field"><span>Extra instructions (optional)</span><textarea id="wo_instr" placeholder="e.g. include a comparison table; cite sources"></textarea></label>
      <div class="inline"><button class="btn ghost" onclick="wfGo(2)">← Back</button><button class="btn" onclick="wfGo(4)">Next: review &amp; generate →</button></div>`);
    return;
  }
  // step 4 — summary + generate
  const plan = wf.data.plan || [];
  const count = wf.data.structure === 'hubspoke' ? plan.reduce((n, c) => n + 1 + (c.spokes || []).length, 0) : (wf.data.keywords || []).length;
  $('#view').innerHTML = wfShell('✍️ Create new content', steps, `
    <h3>Review</h3>
    <p style="font-size:13px">Structure: <b>${wf.data.structure === 'hubspoke' ? 'Hub & spoke' : 'Single article(s)'}</b> · will generate <b>${count}</b> draft(s) via your AI (${esc((window.__wfSettings && window.__wfSettings.ai_provider) || 'AI')}).</p>
    ${wf.data.structure === 'hubspoke'
      ? plan.map((c) => `<div class="card" style="background:var(--bg);margin-bottom:8px"><b>🏛 ${esc(c.hub_keyword)}</b> <span class="muted">+ ${(c.spokes || []).length} spokes</span><br><span style="font-size:12px">${(c.spokes || []).map((s) => `<span class="badge" style="margin:2px">${esc(s)}</span>`).join('')}</span></div>`).join('')
      : `<p>${(wf.data.keywords || []).map((k) => `<span class="badge approved" style="margin:2px">${esc(k)}</span>`).join('')}</p>`}
    <div id="wfGenProgress"></div>
    <div class="inline" style="margin-top:10px"><button class="btn ghost" onclick="wfGo(3)">← Back</button><button class="btn" onclick="wfGenerate()">⚡ Generate ${count} draft(s)</button></div>`);
}
window.wfKwTabSet = (t) => { wfKwTab = t; renderWf(); };
window.wfKwType = () => { const v = $('#wf_type').value.trim(); if (v) { wf.data.keywords.push(v); renderWf(); } };
window.wfKwPaste = () => { const lines = ($('#wf_paste').value || '').split('\n').map((s) => s.trim()).filter(Boolean); wf.data.keywords.push(...lines); wf.data.keywords = [...new Set(wf.data.keywords)]; renderWf(); };
window.wfDelKw = (i) => { wf.data.keywords.splice(i, 1); renderWf(); };
window.wfKwAuto = async () => {
  const el = $('#wfKwAuto'); el.innerHTML = '<div class="empty"><span class="spinner"></span> Finding demand with no page yet…</div>';
  try {
    const d = await api.post('/optimize/scan', { days: 28 });
    const gaps = (d.opportunities || []).filter((o) => o.type === 'gap').slice(0, 15);
    el.innerHTML = gaps.length ? gaps.map((g) => `<label class="field" style="display:flex;flex-direction:row;gap:8px;align-items:center;margin-bottom:3px"><input type="checkbox" class="wf_gap" value="${esc(g.query)}" style="width:auto"/><span style="margin:0;font-size:13px">${esc(g.query)} <span class="muted">(${g.impressions} impr, pos ${g.position})</span></span></label>`).join('') + `<button class="btn sm secondary" style="margin-top:6px" onclick="wfAddGaps()">Add selected</button>` : '<p class="muted">No clear gaps found — type a keyword instead.</p>';
  } catch (e) { el.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; }
};
window.wfAddGaps = () => { const picks = $$('.wf_gap').filter((c) => c.checked).map((c) => c.value); wf.data.keywords.push(...picks); wf.data.keywords = [...new Set(wf.data.keywords)]; renderWf(); };
window.wfKwNext = async () => {
  if (!wf.data.keywords.length) return toast('Add at least one keyword', 'error');
  toast('Checking for duplicate keywords…');
  let r;
  try { r = await api.post('/kwindex/check', { keywords: wf.data.keywords }); }
  catch { r = { existing: [] }; }
  wf.data.dupes = r.existing || [];
  if (wf.data.dupes.length) { renderWf(); return; } // show the warning, don't advance
  wf.step = 2; renderWf();
};
window.wfRemoveCovered = () => {
  const covered = new Set((wf.data.dupes || []).map((d) => d.keyword));
  wf.data.keywords = wf.data.keywords.filter((k) => !covered.has(k));
  wf.data.dupes = [];
  if (!wf.data.keywords.length) { toast('All keywords were already covered — add new ones.', 'error'); renderWf(); return; }
  wf.step = 2; renderWf();
};
window.wfKeepAll = () => { wf.data.allowDuplicates = true; wf.data.dupes = []; wf.step = 2; renderWf(); };
async function loadIdxStatus() { const el = $('#wfIdx'); if (!el) return; try { const s = await api.get('/kwindex'); el.textContent = `${s.count} keyword(s) already covered`; } catch { el.textContent = '—'; } }
window.wfRebuildIdx = async () => { toast('Rebuilding index from your site…'); try { const r = await api.post('/kwindex/build'); toast(`Indexed ${r.count} covered keywords`, 'success'); loadIdxStatus(); } catch (e) { toast(e.message, 'error'); } };
window.wfStructure = async (s) => {
  wf.data.structure = s;
  if (s === 'hubspoke') {
    wf.data.plan = null; renderWf();
    const box = $('#wfProposed'); if (box) box.innerHTML = '<div class="empty"><span class="spinner"></span> Proposing a hub &amp; spoke structure…</div>';
    try {
      const r = await api.post('/clusters/propose', { keywords: wf.data.keywords, maxClusters: wf.data.keywords.length > 6 ? 3 : 1 });
      let plan = r.clusters || [];
      // Drop any proposed spoke/hub that's already covered (unless overriding).
      if (!wf.data.allowDuplicates) {
        const allKw = []; plan.forEach((c) => { allKw.push(c.hub_keyword); (c.spokes || []).forEach((s) => allKw.push(s)); });
        try {
          const chk = await api.post('/kwindex/check', { keywords: allKw });
          const covered = new Set((chk.existing || []).map((e) => e.keyword));
          let removed = 0;
          plan.forEach((c) => { c.spokes = (c.spokes || []).filter((s) => { if (covered.has(s)) { removed++; return false; } return true; }); });
          if (removed) toast(`Skipped ${removed} already-covered spoke(s)`, '');
        } catch { /* ignore */ }
      }
      wf.data.plan = plan; renderWf();
    } catch (e) { const box2 = $('#wfProposed'); if (box2) box2.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; }
  } else { wf.data.plan = (wf.data.keywords || []).map((k) => ({ hub_keyword: k, spokes: [] })); renderWf(); }
};
function renderProposed() {
  const box = $('#wfProposed'); if (!box || !wf.data.plan) return;
  box.innerHTML = `<h3>Proposed structure (edit freely)</h3>${wf.data.plan.map((c, ci) => `<div class="card" style="background:var(--bg);margin-bottom:8px">
    <label class="field"><span>Hub (pillar)</span><input value="${esc(c.hub_keyword || '')}" onchange="wfEditHub(${ci}, this.value)"/></label>
    <div><b style="font-size:12px">Spokes:</b> ${(c.spokes || []).map((s, si) => `<span class="badge" style="margin:2px">${esc(s)} <a href="#" onclick="wfDelSpoke(${ci},${si});return false" style="color:inherit">✕</a></span>`).join('')}</div>
    <div class="inline" style="margin-top:6px"><input id="wf_addspoke_${ci}" placeholder="add a spoke" style="flex:1" onkeydown="if(event.key==='Enter')wfAddSpoke(${ci})"/><button class="btn sm secondary" onclick="wfAddSpoke(${ci})">+ Spoke</button></div>
  </div>`).join('')}`;
}
window.wfEditHub = (ci, v) => { wf.data.plan[ci].hub_keyword = v; };
window.wfDelSpoke = (ci, si) => { wf.data.plan[ci].spokes.splice(si, 1); renderProposed(); };
window.wfAddSpoke = (ci) => { const el = $('#wf_addspoke_' + ci); const v = el.value.trim(); if (v) { wf.data.plan[ci].spokes.push(v); el.value = ''; renderProposed(); } };
// ===========================================================================
// Live article-generation panel — generates a batch of ideas with rich, live
// per-article progress, options, concurrency control, pause/resume & retry.
// Rendered IN-VIEW (inside #genRoot) so per-article previews can stack over it.
// ===========================================================================
let genJob = null;
let _genTimer = null;
const genStrip = (h) => String(h || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function generateBatch(ids, { options = {}, title = 'Generating articles', returnView = 'articles' } = {}) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return toast('Nothing to generate', '');
  let meta = {};
  try { (await api.get('/articles')).forEach((a) => { meta[a.id] = a; }); } catch { /* ignore */ }
  genJob = {
    title, returnView, options, id: Date.now(),
    order: ids.slice(),
    items: new Map(ids.map((id) => [id, { id, keyword: meta[id]?.keyword || ('#' + id), title: meta[id]?.title || '', role: meta[id]?.role || 'spoke', status: 'queued', score: null, words: null, error: null }])),
    concurrency: Math.min(2, ids.length), active: 0, stopped: false, finished: false, startedAt: Date.now(),
  };
  $('#viewTitle').textContent = title;
  const sub = $('#viewSubtitle'); if (sub) sub.textContent = 'Live progress — each draft is written, scored against Rank Math and auto-corrected, then queued for review.';
  $('#view').innerHTML = `<div id="genRoot" data-job="${genJob.id}">${genInnerHtml()}</div>`;
  if (_genTimer) clearInterval(_genTimer);
  _genTimer = setInterval(() => { if (genJob && !genJob.finished) renderGenView(); else { clearInterval(_genTimer); _genTimer = null; } }, 1000);
  pumpGen();
}
function genCounts() {
  const c = { queued: 0, generating: 0, done: 0, failed: 0 };
  for (const it of genJob.items.values()) c[it.status]++;
  return c;
}
function nextQueuedId() {
  for (const id of genJob.order) if (genJob.items.get(id).status === 'queued') return id;
  return undefined;
}
function pumpGen() {
  const job = genJob; if (!job) return;
  while (!job.stopped && job.active < job.concurrency) {
    const id = nextQueuedId();
    if (id === undefined) break;
    job.active++;
    genOne(id).finally(() => { job.active--; pumpGen(); });
  }
  if (!job.finished && job.active === 0 && nextQueuedId() === undefined) finishGen();
  else renderGenView();
}
async function genOne(id) {
  const it = genJob.items.get(id);
  it.status = 'generating'; it.error = null; it.startedAt = Date.now(); renderGenView();
  try {
    const art = await api.post(`/articles/${id}/generate`, genJob.options);
    it.status = 'done'; it.score = art.seo_score; it.title = art.title || it.title;
    it.words = art.content ? genStrip(art.content).split(' ').filter(Boolean).length : null;
  } catch (e) { it.status = 'failed'; it.error = e.message; }
  renderGenView();
}
function finishGen() {
  if (!genJob || genJob.finished) return;
  genJob.finished = true;
  if (_genTimer) { clearInterval(_genTimer); _genTimer = null; }
  const c = genCounts();
  toast(c.failed ? `Done: ${c.done} generated, ${c.failed} failed` : `All ${c.done} draft(s) ready ✨`, c.failed ? '' : 'success');
  renderGenView();
  updateGenPill();
  // If the user is on a list view (not the panel), refresh so 'generating' rows update.
  if (!document.getElementById('genRoot') && ['articles', 'clusters', 'workflow', 'strategy'].includes(current) && views[current]) {
    try { views[current](); } catch { /* ignore */ }
  }
}
function genOptsSummary(o) {
  const parts = [];
  if (o.words_min || o.words_max) parts.push(`${o.words_min || '?'}–${o.words_max || '?'} words`);
  if (o.tone) parts.push(`tone: ${esc(o.tone)}`);
  if (o.angle) parts.push(`angle: ${esc(o.angle)}`);
  if (o.instructions) parts.push('custom instructions');
  return parts.length ? parts.join(' · ') : 'Using your default content &amp; SEO settings (words, tone, Rank Math targets)';
}
const GEN_ICON = { queued: '⏳', generating: '<span class="spinner"></span>', done: '✅', failed: '⚠️' };
const GEN_LABEL = { queued: 'Queued', done: 'Ready', failed: 'Failed' };
// Simulated staged progress for a single article (the server runs one long call,
// so we ease toward ~92% over the expected duration, then snap to 100% on done).
function genStage(it) {
  const elapsed = Date.now() - (it.startedAt || Date.now());
  const pct = Math.min(92, Math.round((elapsed / 52000) * 100));
  const stage = pct < 12 ? 'Gathering internal links…'
    : pct < 36 ? 'Writing the draft…'
    : pct < 62 ? 'Adding visuals &amp; key takeaways…'
    : pct < 82 ? 'Scoring against Rank Math…'
    : 'Self-correcting &amp; finalising…';
  return { pct, stage, secs: Math.round(elapsed / 1000) };
}
function genItemHtml(it) {
  let progress = '';
  if (it.status === 'generating') {
    const s = genStage(it);
    progress = `<div class="gen-prog"><i style="width:${s.pct}%"></i></div>`;
  }
  const sub = it.status === 'generating'
    ? (() => { const s = genStage(it); return `<span>${it.role === 'hub' ? '🏛 hub' : '• spoke'}</span><span class="gen-step">${s.stage}</span><span>${s.secs}s</span>`; })()
    : `<span>${it.role === 'hub' ? '🏛 hub' : '• spoke'}</span><span>${GEN_LABEL[it.status]}</span>${it.score != null ? `<span>Rank Math ${seoPill(it.score)}</span>` : ''}${it.words ? `<span>${it.words} words</span>` : ''}${it.error ? `<span class="badge failed" title="${esc(it.error)}">${esc(it.error.slice(0, 44))}</span>` : ''}`;
  return `<div class="gen-item s-${it.status}">
    <div class="gen-ico">${GEN_ICON[it.status]}</div>
    <div>
      <div class="gen-it-title">${esc(it.title || it.keyword)}</div>
      <div class="gen-it-sub">${sub}</div>
      ${progress}
    </div>
    <div class="gen-actions">
      ${it.status === 'done' ? `<button class="btn sm secondary" onclick="previewArticle(${it.id})" data-tip="Preview on your theme">👁</button>
        <button class="btn sm ghost" onclick="openArticle(${it.id})">✏️ Open</button>` : ''}
      ${it.status === 'failed' ? `<button class="btn sm" onclick="genRetry(${it.id})">🔁 Retry</button>` : ''}
    </div>
  </div>`;
}
function genInnerHtml() {
  const job = genJob; const c = genCounts(); const total = job.order.length;
  const fin = c.done + c.failed; const pct = total ? Math.round(fin / total * 100) : 0;
  const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
  const eta = (c.done && !job.finished) ? Math.round(((Date.now() - job.startedAt) / Math.max(c.done, 1)) * c.queued / 1000) : 0;
  return `
    <div class="card">
      <div class="section-head" style="margin-bottom:10px"><h2 style="margin:0">⚡ ${esc(job.title)}</h2>
        ${job.finished ? '<span class="badge published">complete</span>' : '<span class="badge generating">in progress</span>'}</div>
      <p class="hint" style="margin:0 0 12px">Each draft is written, scored against Rank Math, and auto-corrected until it hits your target — then queued for review. ${genOptsSummary(job.options)}.</p>
      <div class="gen-head">
        <div class="gen-bigstat">${fin}<small>/${total} done</small></div>
        <div class="gen-bar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="gen-head" style="margin-bottom:0">
        <div class="gen-stats">
          <span class="badge approved">✅ ${c.done} ready</span>
          <span class="badge generating">⚡ ${c.generating} writing</span>
          <span class="badge">⏳ ${c.queued} queued</span>
          ${c.failed ? `<span class="badge failed">⚠ ${c.failed} failed</span>` : ''}
          <span class="badge">⏱ ${elapsed}s${eta ? ` · ~${eta}s left` : ''}</span>
        </div>
        <div class="spacer" style="flex:1"></div>
        <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:6px">⚙ Parallel
          <select onchange="genSetConc(this.value)" ${job.finished ? 'disabled' : ''} style="width:64px">${[1, 2, 3, 4].map((n) => `<option ${job.concurrency === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${!job.finished ? (job.stopped ? '<button class="btn sm success" onclick="genResume()">▶ Resume</button>' : '<button class="btn sm secondary" onclick="genStop()">⏸ Pause</button>') : ''}
        ${c.failed ? `<button class="btn sm" onclick="genRetryFailed()">🔁 Retry failed (${c.failed})</button>` : ''}
      </div>
      <div class="gen-list">${job.order.map((id) => genItemHtml(job.items.get(id))).join('')}</div>
      <div class="inline" style="justify-content:flex-end">
        ${job.finished
          ? (job.order.length === 1
              ? `<button class="btn ghost" onclick="navigate('${job.returnView}')">Done</button><button class="btn" onclick="openArticle(${job.order[0]})">✏️ Open the draft</button>`
              : `<button class="btn ghost" onclick="navigate('${job.returnView}')">Close</button><button class="btn" onclick="navigate('${job.returnView}')">Review all in Content →</button>`)
          : `<span class="muted" style="font-size:12px">You can pause anytime. Navigating away keeps generation running in the background.</span>`}
      </div>
    </div>`;
}
function renderGenView() {
  if (!genJob) return;
  const root = document.getElementById('genRoot');
  if (!root || root.dataset.job !== String(genJob.id)) { updateGenPill(); return; } // navigated away — show the pill instead
  const list = root.querySelector('.gen-list'); const sc = list ? list.scrollTop : 0;
  root.innerHTML = genInnerHtml();
  const nl = root.querySelector('.gen-list'); if (nl) nl.scrollTop = sc;
  updateGenPill();
}
// Re-open the live generation panel (running OR finished) — from the pill or a row.
window.reopenGenPanel = () => {
  if (!genJob) return toast('No active generation', '');
  genJob._dismissed = false;
  $('#viewTitle').textContent = genJob.title;
  const sub = $('#viewSubtitle'); if (sub) sub.textContent = 'Live progress — each draft is written, scored against Rank Math and auto-corrected, then queued for review.';
  $('#view').innerHTML = `<div id="genRoot" data-job="${genJob.id}">${genInnerHtml()}</div>`;
  if (!genJob.finished && !_genTimer) _genTimer = setInterval(() => { if (genJob && !genJob.finished) renderGenView(); else { clearInterval(_genTimer); _genTimer = null; } }, 1000);
  updateGenPill();
};
// Floating pill that lets the user return to a running/finished job after navigating away.
function updateGenPill() {
  const pill = document.getElementById('genPill'); if (!pill) return;
  const onPanel = !!(document.getElementById('genRoot') && document.getElementById('genRoot').dataset.job === String(genJob && genJob.id));
  if (!genJob || onPanel || genJob._dismissed) { pill.className = 'gen-pill hidden'; return; }
  const c = genCounts(); const total = genJob.order.length; const fin = c.done + c.failed;
  pill.className = 'gen-pill';
  pill.innerHTML = `<span class="gp-ico">${genJob.finished ? '✅' : '<span class="spinner"></span>'}</span>
    <span class="gp-txt">${genJob.finished ? `Generated ${c.done}/${total}${c.failed ? ` · ${c.failed} failed` : ''}` : `Generating ${fin}/${total}…`}</span>
    <button class="btn sm" onclick="reopenGenPanel()">View</button>
    <button class="gp-x" onclick="dismissGenPill()" title="Dismiss">✕</button>`;
}
window.dismissGenPill = () => { if (genJob) genJob._dismissed = true; updateGenPill(); };
// Clicked a "generating" article row → jump back to its live panel (or open it).
window.viewGen = (id) => { if (genJob && genJob.items.has(id) && !genJob.finished) reopenGenPanel(); else openArticle(id); };
window.genStop = () => { if (genJob) { genJob.stopped = true; renderGenView(); toast('Paused — in-flight drafts finish, no new ones start', ''); } };
window.genResume = () => { if (genJob) { genJob.stopped = false; pumpGen(); } };
window.genSetConc = (n) => { if (genJob) { genJob.concurrency = Math.max(1, Math.min(4, +n || 1)); pumpGen(); } };
window.genRetry = (id) => { if (genJob && genJob.items.has(id)) { genJob.items.get(id).status = 'queued'; genJob.finished = false; if (!_genTimer) _genTimer = setInterval(() => { if (genJob && !genJob.finished) renderGenView(); else { clearInterval(_genTimer); _genTimer = null; } }, 1000); pumpGen(); } };
window.genRetryFailed = () => { if (!genJob) return; for (const it of genJob.items.values()) if (it.status === 'failed') it.status = 'queued'; genJob.finished = false; if (!_genTimer) _genTimer = setInterval(() => { if (genJob && !genJob.finished) renderGenView(); else { clearInterval(_genTimer); _genTimer = null; } }, 1000); pumpGen(); };

window.wfGenerate = async () => {
  // capture options from step 3 inputs if present (else defaults)
  wf.data.options = wf.data.options || {};
  const opts = wf.data.options;
  const prog = $('#wfGenProgress');
  const setProg = (h) => { if (prog) prog.innerHTML = h; };
  let ids = [];
  try {
    if (wf.data.structure === 'hubspoke') {
      const r = await api.post('/clusters/create', { clusters: wf.data.plan, allowDuplicates: !!wf.data.allowDuplicates });
      for (const c of r.created) { const arts = await api.get('/articles?cluster=' + c.id); ids.push(...arts.filter((a) => a.status === 'idea').map((a) => a.id)); }
    } else {
      for (const k of wf.data.keywords) { const { id } = await api.post('/articles/idea', { keyword: k }); ids.push(id); }
    }
  } catch (e) { return toast(e.message, 'error'); }
  // Hand off to the rich live generation panel.
  generateBatch(ids, { options: opts, title: 'Generating your content', returnView: 'articles' });
};

// Capture step-3 options before leaving (wfGo wrapper for create options)
const _wfGoOrig = window.wfGo;
window.wfGo = (step) => {
  if (wf.mode === 'create' && wf.step === 3) {
    wf.data.options = {};
    const v = (id) => { const el = $('#' + id); return el ? el.value.trim() : ''; };
    if (v('wo_wmin')) wf.data.options.words_min = v('wo_wmin');
    if (v('wo_wmax')) wf.data.options.words_max = v('wo_wmax');
    if (v('wo_tone')) wf.data.options.tone = v('wo_tone');
    if (v('wo_angle')) wf.data.options.angle = v('wo_angle');
    if (v('wo_instr')) wf.data.options.instructions = v('wo_instr');
  }
  _wfGoOrig(step);
};
// Prefill option defaults + AI provider name when entering the wizard.
(async () => { try { const s = await api.get('/settings'); window.__wfSettings = s; } catch {} })();

// ---- SEO Strategy ---------------------------------------------------------
const ACTION_META = {
  keep: { b: 'published', l: 'Keep' }, improve_ctr: { b: 'pending_review', l: 'Improve CTR' },
  refresh: { b: 'pending_review', l: 'Refresh' }, expand: { b: 'pending_review', l: 'Expand' },
  add_spokes: { b: 'approved', l: 'Add spokes' }, merge: { b: 'idea', l: 'Merge' }, prune: { b: 'failed', l: 'Prune' },
};
// The SEO Strategy page is the COMMAND CENTER: keywords → clusters → articles →
// publish are all driven inline here, no need to visit the other tabs.
views.strategy = async () => {
  $('#view').innerHTML = '<div class="empty"><span class="spinner"></span> Loading…</div>';
  const [audit, doc] = await Promise.all([api.get('/strategy/audit').catch(() => null), api.get('/strategy/doc').catch(() => null)]);
  $('#view').innerHTML = `
    <div class="card">
      <div class="section-head"><h2>🧭 SEO Strategy &amp; Audit</h2>
        <div class="inline" style="margin:0;flex-wrap:wrap">
          <button class="btn secondary" onclick="navigate('workflow')">✨ Go to Workflow</button>
          <button class="btn" onclick="runAudit()">${audit ? '🔄 Re-run audit' : '▶ Run audit'}</button>
        </div></div>
      <p class="hint">The analysis &amp; roadmap. Each recommendation’s <b>Optimize →</b> / <b>Create →</b> button takes you into the Workflow to act.</p>
      ${audit ? auditSummary(audit) : '<p class="muted">Run an audit to map your whole site — what to keep, improve, refresh, expand, cluster or prune.</p>'}
    </div>
    ${audit ? strategyBody(audit) : ''}
    <div class="card" style="margin-top:16px" id="roadmapCard">${roadmapHtml(doc)}</div>`;
};
window.scanOppsCmd = async () => {
  const el = $('#cmdOpps');
  el.innerHTML = '<div class="empty"><span class="spinner"></span> Scanning Search Console…</div>';
  let d;
  try { d = await api.post('/optimize/scan', { days: 28 }); }
  catch (e) { el.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; return; }
  const top = (d.opportunities || []).filter((o) => ['ctr', 'refresh', 'gap'].includes(o.type)).slice(0, 15);
  if (!top.length) { el.innerHTML = '<div class="empty">No quick wins right now — re-scan as data accrues.</div>'; return; }
  el.innerHTML = `<table><thead><tr><th>Target</th><th>Type</th><th>Impr</th><th>Pos</th><th>~clicks/mo</th><th></th></tr></thead><tbody>
    ${top.map((o) => `<tr>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${esc(o.url || o.query)}</td>
      <td>${OPP_META[o.type].icon} ${OPP_META[o.type].label}</td>
      <td>${o.impressions ?? '–'}</td><td>${o.position ?? '–'}</td><td>${o.gain ? '+' + o.gain : '–'}</td>
      <td class="row-actions">${o.type === 'gap'
        ? `<button class="btn sm success" onclick='goWorkflowCreate(${JSON.stringify([o.query])})'>Create →</button>`
        : `<button class="btn sm" onclick="goWorkflowImprove('${esc(o.url)}')">Optimize →</button>`}</td></tr>`).join('')}
  </tbody></table>`;
};
window.gapIdeaCmd = async (q) => { await api.post('/optimize/gap', { query: q }); toast('Added to content pipeline', 'success'); loadStrategyPipeline(); };

// ---- Inline content pipeline (works from the Strategy command center) ------
async function loadStrategyPipeline() {
  const el = $('#stratPipeline'); if (!el) return;
  const all = await api.get('/articles');
  const groups = { idea: [], pending_review: [], approved: [], published: [] };
  all.forEach((a) => { if (groups[a.status]) groups[a.status].push(a); });
  const stat = $('#pipeStat');
  if (stat) stat.textContent = `${groups.idea.length} ideas · ${groups.pending_review.length} drafts · ${groups.approved.length} approved · ${groups.published.length} live`;
  const rowsFor = (arr) => arr.slice(0, 50).map((a) => `<tr>
    <td>${a.title ? `<b>${esc(a.title)}</b><br><span class="muted" style="font-size:11px">${esc(a.keyword)}</span>` : esc(a.keyword)}</td>
    <td>${seoPill(a.seo_score)}</td><td>${badge(a.status)}</td>
    <td class="row-actions">
      ${a.status === 'idea' ? `<button class="btn sm" onclick="generateOne(${a.id},'strategy')">Generate</button>` : ''}
      ${a.title ? `<button class="btn sm secondary" onclick="openArticle(${a.id},{from:'strategy'})">Open</button>` : ''}
      ${a.status === 'pending_review' ? `<button class="btn sm success" onclick="pipeApprove(${a.id})">Approve &amp; publish</button>` : ''}
      ${a.status === 'approved' ? `<button class="btn sm success" onclick="pipePublish(${a.id})">Publish</button>` : ''}
      ${a.wp_url ? `<a class="btn sm ghost" href="${esc(a.wp_url)}" target="_blank">↗</a>` : ''}
    </td></tr>`).join('');
  const queue = [...groups.idea, ...groups.pending_review, ...groups.approved];
  el.innerHTML = `
    <div class="inline" style="margin-bottom:10px">
      <input id="pipeIdea" placeholder="Add an article idea (keyword)…" style="min-width:240px" onkeydown="if(event.key==='Enter')pipeAddIdea()"/>
      <button class="btn sm secondary" onclick="pipeAddIdea()">+ Add idea</button>
      ${groups.idea.length ? `<button class="btn sm" onclick="pipeGenAll()">⚡ Generate all ${groups.idea.length} ideas</button>` : ''}
      <div class="spacer"></div>
      <button class="btn sm ghost" onclick="navigate('articles')">Open full Articles ↗</button>
    </div>
    ${queue.length ? `<table><thead><tr><th>Article</th><th>SEO</th><th>Status</th><th></th></tr></thead><tbody>${rowsFor(queue)}</tbody></table>`
      : '<div class="empty">Nothing queued. Add an idea, or plan a hub &amp; spoke above.</div>'}`;
}
window.pipeGen = (id) => generateOne(id, 'strategy');
window.pipeApprove = async (id) => { toast('Approving & publishing…'); try { await api.post(`/articles/${id}/approve`, { publishNow: true }); toast('Published!', 'success'); loadStrategyPipeline(); } catch (e) { toast(e.message, 'error'); } };
window.pipePublish = async (id) => { toast('Publishing…'); try { if (await doPublishGuarded(`/articles/${id}/publish`, id)) toast('Published!', 'success'); loadStrategyPipeline(); } catch (e) { toast(e.message, 'error'); } };
window.pipeAddIdea = async () => { const k = $('#pipeIdea').value.trim(); if (!k) return; await api.post('/articles/idea', { keyword: k }); toast('Idea added', 'success'); loadStrategyPipeline(); };
window.pipeGenAll = async () => {
  const all = await api.get('/articles?status=idea');
  if (!all.length) return toast('No ideas to generate', '');
  generateBatch(all.map((a) => a.id), { title: 'Generating all ideas', returnView: 'strategy' });
};
window.researchKwInline = async () => {
  modal('Research keywords (Ahrefs)', `
    <div class="inline"><label class="field" style="flex:1"><span>Seed keyword / topic</span><input id="rk_seed" placeholder="e.g. linear algebra for machine learning"/></label>
      <label class="field" style="width:110px"><span>Limit</span><input id="rk_limit" type="number" value="50"/></label></div>
    <p class="hint">Imports keyword ideas, then use “Plan hub &amp; spoke” to cluster them — all without leaving this page.</p>
    <div class="inline"><button class="btn" onclick="rkDo()">Fetch ideas</button><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
};
window.rkDo = async () => {
  const seed = $('#rk_seed').value.trim(); if (!seed) return toast('Enter a seed', 'error');
  toast('Querying Ahrefs…');
  try { const r = await api.post('/keywords/research', { seed, limit: +$('#rk_limit').value || 50 }); toast(`Imported ${r.imported} keywords — now Plan hub & spoke`, 'success'); closeModal(); }
  catch (e) { toast(e.message, 'error'); }
};
function auditSummary(a) {
  const c = a.summary?.counts || {};
  const chip = (k) => c[k] ? `<span class="badge ${ACTION_META[k]?.b || ''}" style="margin:2px">${c[k]} ${ACTION_META[k]?.l || k}</span>` : '';
  return `<p class="muted">Audited <b>${a.summary?.posts || 0}</b> posts (${a.summary?.withGsc || 0} with GSC data) · ${esc((a.generatedAt || '').slice(0, 10))}</p>
    <p>${Object.keys(ACTION_META).map(chip).join(' ')}</p>
    ${a.quickWins?.length ? `<div class="bulkbar" style="border-color:var(--accent-2)"><b>⚡ Quick wins:</b> <ol style="margin:0;padding-left:18px">${a.quickWins.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></div>` : ''}`;
}
function strategyBody(a) {
  const clusters = a.clusters || [];
  const actions = a.actions || [];
  const links = a.internalLinks || [];
  return `
    <div class="card" style="margin-top:16px"><div class="section-head"><h2>🕸 Hub &amp; spoke map</h2></div>
      ${(a.newHubs || []).length ? `<p class="muted">Recommended new hubs: ${a.newHubs.map((h) => `<span class="badge approved" style="margin:2px">${esc(h)}</span>`).join('')}</p>` : ''}
      <div class="grid cols-2">${clusters.map((cl) => `<div class="card" style="background:var(--bg)">
        <div class="section-head" style="margin-bottom:6px"><h2 style="font-size:14px">${esc(cl.hub)}</h2><span class="badge ${cl.status === 'new' ? 'approved' : 'published'}">${esc(cl.status || '')}</span></div>
        <p style="font-size:12px" class="muted">${(cl.spokes || []).length} spokes</p>
        ${(cl.gaps || []).length ? `<p style="font-size:12px"><b>Gaps:</b> ${cl.gaps.map((g) => `<span class="badge" style="margin:2px">${esc(g)}</span>`).join('')}</p>
          <button class="btn sm success" onclick='addSpokeIdeas(${JSON.stringify(cl.gaps)})'>+ Add ${cl.gaps.length} spoke ideas</button>` : ''}
      </div>`).join('')}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="section-head"><h2>📋 Per-article actions (${actions.length})</h2></div>
      <table><thead><tr><th>Article</th><th>Action</th><th>Why</th><th>Priority</th><th></th></tr></thead><tbody>
        ${actions.map((x) => `<tr>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${x.url ? `<a href="${esc(x.url)}" target="_blank">${esc(x.title || x.url)}</a>` : esc(x.title || '')}</td>
          <td><span class="badge ${ACTION_META[x.action]?.b || ''}">${ACTION_META[x.action]?.l || esc(x.action)}</span></td>
          <td class="muted" style="font-size:12px">${esc(x.reason || '')}</td>
          <td>${badge(x.priority === 'high' ? 'failed' : x.priority === 'medium' ? 'pending_review' : 'idea')}</td>
          <td class="row-actions">${actionBtn(x)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    ${links.length ? `<div class="card" style="margin-top:16px"><div class="section-head"><h2>🔗 Internal linking plan (${links.length})</h2></div>
      <table><thead><tr><th>From</th><th>→ To</th><th>Anchor</th><th>Why</th></tr></thead><tbody>
        ${links.map((l) => `<tr><td style="font-size:12px">${esc(l.from)}</td><td style="font-size:12px">${esc(l.to)}</td><td><b>${esc(l.anchor || '')}</b></td><td class="muted" style="font-size:12px">${esc(l.why || '')}</td></tr>`).join('')}
      </tbody></table>
      <p class="hint">Add these links inside the relevant posts (WordPress → Posts → edit), or let a content refresh insert them automatically.</p></div>` : ''}`;
}
function actionBtn(x) {
  if (!x.url) return '';
  if (['refresh', 'expand', 'improve_ctr', 'add_spokes', 'merge'].includes(x.action)) {
    return `<button class="btn sm" onclick="goWorkflowImprove('${esc(x.url)}')">Optimize →</button>`;
  }
  return `<a class="btn sm ghost" href="${esc(x.url)}" target="_blank">↗</a>`;
}
// Brief & to the point: lead with "this month", everything else collapsible.
function roadmapHtml(doc) {
  if (!doc) return `<div class="section-head"><h2>🗺 Strategy &amp; roadmap</h2></div>
    <div class="empty"><span class="spinner"></span> Generating your strategy in the background — it'll appear here automatically.</div>`;
  const months = doc.roadmap || [];
  const now = months[0];
  const monthCard = (m) => `<div class="card" style="background:var(--bg);margin-bottom:8px"><b>${esc(m.month)} — ${esc(m.focus)}</b>
    <ul style="margin:6px 0">${(m.tasks || []).map((t) => `<li style="font-size:13px">${esc(t)}</li>`).join('')}</ul>
    ${m.kpis ? `<p class="hint" style="margin:0">KPIs: ${esc(m.kpis)}</p>` : ''}</div>`;
  return `<div class="section-head"><h2>🗺 Strategy &amp; roadmap</h2></div>
    ${now ? `<div class="bulkbar" style="border-color:var(--accent-2)"><div><b>▶ Now — ${esc(now.month)}: ${esc(now.focus)}</b>
      <ul style="margin:6px 0 0;font-size:13px">${(now.tasks || []).slice(0, 4).map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div></div>` : ''}
    <details><summary>📅 Full ${months.length}-month roadmap</summary><div style="margin-top:10px">${months.map(monthCard).join('')}</div></details>
    <details><summary>🔗 Genuine backlink tactics (${(doc.backlinks || []).length})</summary><div style="margin-top:10px">${(doc.backlinks || []).map((b) => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><b>${esc(b.tactic)}</b> ${b.difficulty ? badge(b.difficulty === 'high' ? 'failed' : b.difficulty === 'low' ? 'published' : 'pending_review') : ''}<br><span class="muted" style="font-size:13px">${esc(b.how)}</span></div>`).join('')}</div></details>
    ${(doc.humanContentGuidelines || []).length ? `<details><summary>✍️ Human-content guidelines</summary><ul style="margin-top:10px">${doc.humanContentGuidelines.map((g) => `<li style="font-size:13px">${esc(g)}</li>`).join('')}</ul></details>` : ''}
    ${(doc.technicalChecklist || []).length ? `<details><summary>⚙️ Technical SEO checklist</summary><ul style="margin-top:10px">${doc.technicalChecklist.map((g) => `<li style="font-size:13px">${esc(g)}</li>`).join('')}</ul></details>` : ''}
    ${doc.summary ? `<details><summary>📄 Full strategy narrative</summary><p class="muted" style="margin-top:10px;font-size:13px;line-height:1.6">${esc(doc.summary)}</p></details>` : ''}`;
}
window.runAudit = async () => { toast('Auditing your live site (can take ~30-60s)…'); try { await api.post('/strategy/audit'); toast('Audit complete', 'success'); views.strategy(); } catch (e) { toast(e.message, 'error'); } };
window.addSpokeIdeas = async (gaps) => { let n = 0; for (const g of gaps) { try { await api.post('/articles/idea', { keyword: g }); n++; } catch {} } toast(`Added ${n} spoke ideas to the pipeline`, 'success'); if (current === 'strategy') loadStrategyPipeline(); };

// ---- Keywords -------------------------------------------------------------
views.keywords = async () => {
  const kws = await api.get('/keywords');
  $('#view').innerHTML = `
    <div class="card">
      <h3>Research with Ahrefs</h3>
      <div class="inline">
        <label class="field" style="flex:1"><span>Seed keyword / topic</span><input id="seed" placeholder="e.g. cctv installation"/></label>
        <label class="field" style="width:120px"><span>Limit</span><input id="seedLimit" type="number" value="50"/></label>
        <button class="btn" onclick="research()">Fetch ideas</button>
      </div>
      <div class="inline" style="margin-top:6px">
        <label class="field" style="flex:1"><span>…or add a keyword manually</span><input id="manualKw" placeholder="exact keyword"/></label>
        <button class="btn secondary" onclick="addManualKw()">Add</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head"><h2>Keywords (${kws.length})</h2>
        <button class="btn success sm" onclick='goWorkflowCreate(${JSON.stringify(kws.filter((k) => k.status === 'new').map((k) => k.keyword))})' ${kws.filter(k=>k.status==='new').length?'':'disabled'}>✨ Build content from these →</button></div>
      ${kws.length ? `<table><thead><tr><th>Keyword</th><th>Vol</th><th>KD</th><th>Intent</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>
        ${kws.map((k) => `<tr>
          <td>${esc(k.keyword)}</td><td>${k.volume ?? '–'}</td><td>${k.difficulty ?? '–'}</td>
          <td>${esc(k.intent || '–')}</td><td>${esc(k.source)}</td><td>${badge(k.status)}</td>
          <td class="row-actions">
            <button class="btn sm" onclick='goWorkflowCreate(${JSON.stringify([k.keyword])})' title="Create content from this keyword in the Workflow">→ create</button>
            <button class="btn sm ghost" onclick="delKw(${k.id})">✕</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No keywords yet. Research a seed or add one manually.</div>'}
    </div>`;
};
window.research = async () => {
  const seed = $('#seed').value.trim();
  if (!seed) return toast('Enter a seed keyword', 'error');
  toast('Querying Ahrefs…');
  try { const r = await api.post('/keywords/research', { seed, limit: +$('#seedLimit').value || 50 });
    toast(`Imported ${r.imported} keywords`, 'success'); views.keywords();
  } catch (e) { toast(e.message, 'error'); }
};
window.addManualKw = async () => {
  const keyword = $('#manualKw').value.trim();
  if (!keyword) return;
  await api.post('/keywords/manual', { keyword });
  toast('Added', 'success'); views.keywords();
};
window.delKw = async (id) => { await api.del('/keywords/' + id); views.keywords(); };
window.kwToArticle = async (keyword) => { await api.post('/articles/idea', { keyword }); toast(`"${keyword}" → article idea added`, 'success'); };
window.planClusters = async () => {
  const s = await api.get('/settings');
  const intents = ['mixed', 'informational', 'commercial', 'transactional'];
  modal('Plan hub & spoke', `
    <div class="grid cols-2">
      <label class="field"><span>Number of clusters</span><input id="pl_clusters" type="number" min="1" max="10" value="${esc(s.clusters_default || '3')}"/></label>
      <label class="field"><span>Spokes per cluster</span><input id="pl_spokes" type="number" min="2" max="20" value="${esc(s.spokes_per_cluster || '6')}"/></label>
    </div>
    <label class="field"><span>Search intent focus</span><select id="pl_intent">
      ${intents.map((o) => `<option ${s.cluster_intent === o ? 'selected' : ''}>${o}</option>`).join('')}
    </select></label>
    <label class="field"><span>What to include / focus (optional)</span>
      <textarea id="pl_brief" placeholder="e.g. focus on the Nairobi market; include buyer guides, comparisons and how-tos; target installers and procurement teams"></textarea></label>
    <p class="hint">Articles generated from these clusters follow your Rank Math SEO requirements (Settings → SEO &amp; content).</p>
    <div class="inline"><button class="btn" onclick="runPlan()">🕸 Plan with AI</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
};
window.runPlan = async () => {
  const body = {
    maxClusters: +$('#pl_clusters').value || 3,
    spokesPerCluster: +$('#pl_spokes').value || 6,
    intent: $('#pl_intent').value,
    brief: $('#pl_brief').value.trim(),
  };
  closeModal();
  toast('Planning clusters with AI…');
  try { const r = await api.post('/clusters/plan', body);
    toast(`Created ${r.created.length} cluster(s) — spokes queued in the pipeline`, 'success');
    // Stay where you are: refresh the inline pipeline on Strategy, else go to clusters.
    if (current === 'strategy') loadStrategyPipeline();
    else navigate('clusters');
  } catch (e) { toast(e.message, 'error'); }
};

// ---- Clusters -------------------------------------------------------------
views.clusters = async () => {
  // Connected workspace: pull clusters + ALL articles, group articles per cluster.
  const [list, allArts] = await Promise.all([api.get('/clusters'), api.get('/articles')]);
  const byCluster = {};
  allArts.forEach((a) => { if (a.cluster_id) (byCluster[a.cluster_id] = byCluster[a.cluster_id] || []).push(a); });
  articleReturnView = 'clusters';
  $('#view').innerHTML = `
    ${pipelineFlow('clusters')}
    <div class="card" style="margin-bottom:16px;border:1px dashed var(--accent)">
      <div class="section-head" style="margin-bottom:8px"><h3 style="margin:0">📤 Upload keywords → propose hubs &amp; spokes</h3></div>
      <p class="hint" style="margin:0 0 10px">Upload an <b>Excel (.xlsx/.xls)</b> or <b>CSV</b> of keywords. Choose <b>hub &amp; spoke</b> (the AI groups them into a topical pillar + supporting articles) or <b>standalone articles</b> (one per keyword). A “keyword” column is auto-detected (optional volume / difficulty columns). Keywords the same or similar to existing content are skipped automatically.</p>
      <div class="toolbar" style="margin-bottom:0">
        <input type="file" id="kwFile" accept=".xlsx,.xls,.csv" style="min-width:230px"/>
        <label class="field" style="margin:0"><span style="font-size:11px">Structure</span><select id="kwStructure" style="width:200px" onchange="kwStructureChange()">
          <option value="hubspoke">Hub &amp; spoke clusters</option><option value="standalone">Standalone articles</option></select></label>
        <label class="field hs-only" style="margin:0"><span style="font-size:11px">Max clusters</span><input id="kwMaxClusters" type="number" value="5" style="width:90px"/></label>
        <label class="field hs-only" style="margin:0"><span style="font-size:11px">Spokes / cluster</span><input id="kwSpokes" type="number" value="6" style="width:90px"/></label>
        <label class="field hs-only" style="margin:0"><span style="font-size:11px">Intent</span><select id="kwIntent" style="width:140px">
          <option value="mixed">Mixed</option><option value="informational">Informational</option><option value="commercial">Commercial</option><option value="transactional">Transactional</option></select></label>
        <button class="btn" id="kwGoBtn" onclick="uploadKwFile()">🧩 Analyze &amp; propose</button>
      </div>
      <div id="kwUploadOut" class="muted" style="font-size:12px;margin-top:8px"></div>
    </div>
    <div class="section-head"><h2>Hub &amp; spoke clusters (${list.length})</h2>
      <div class="inline" style="margin:0"><button class="btn sm" onclick="goWorkflowCreate([])">✨ Create in Workflow</button>
        <button class="btn sm secondary" onclick="navigate('strategy')">Command Center ↗</button></div></div>
    ${list.length ? list.map((c) => {
      const arts = (byCluster[c.id] || []).sort((a, b) => (a.role === 'hub' ? -1 : 1));
      const live = arts.filter((a) => a.status === 'published').length;
      const artRow = (a) => `<tr>
        <td>${a.role === 'hub' ? '🏛 ' : '• '}${a.title ? esc(a.title) : esc(a.keyword)}${a.title ? `<br><span class="muted" style="font-size:11px">${esc(a.keyword)}</span>` : ''}</td>
        <td>${badge(a.role)}</td><td>${seoPill(a.seo_score)}</td><td>${badge(a.status)}</td>
        <td class="row-actions">
          ${a.status === 'idea' ? `<button class="btn sm" onclick="generateOne(${a.id},'clusters')">Generate</button>` : a.status === 'generating' ? `<button class="btn sm" onclick="viewGen(${a.id})"><span class="spinner"></span> Progress</button>` : `<button class="btn sm secondary" onclick="openArticle(${a.id},{from:'clusters'})">Open</button>`}
          ${a.status === 'pending_review' ? `<button class="btn sm success" onclick="approveArticle(${a.id})">Approve</button>` : ''}
          ${a.status === 'approved' ? `<button class="btn sm success" onclick="publishArticle(${a.id})">Publish</button>` : ''}
          ${a.wp_url ? `<a class="btn sm ghost" href="${esc(a.wp_url)}" target="_blank">↗</a>` : ''}
        </td></tr>`;
      return `<div class="card" style="margin-bottom:16px">
        <div class="section-head"><h2 style="font-size:15px">🕸 ${esc(c.name)}</h2>
          <span>${badge(c.status)} <span class="muted" style="font-size:12px">${arts.length} articles · ${live} live</span></span></div>
        <p class="muted" style="font-size:13px">HUB keyword: <b>${esc(c.hub_keyword)}</b> · intent ${esc(c.intent || '—')}
          ${c.wp_page_id ? '· <span class="badge published">hub page live</span>' : ''}</p>
        ${arts.length ? `<table><thead><tr><th>Article</th><th>Role</th><th>SEO</th><th>Status</th><th></th></tr></thead><tbody>${arts.map(artRow).join('')}</tbody></table>` : '<p class="muted">No articles yet.</p>'}
        <div class="inline" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn sm success" onclick="genClusterArticles(${c.id})">⚡ Generate all drafts</button>
          <button class="btn sm success" onclick="publishClusterArticles(${c.id})">⬆ Publish ready</button>
          <button class="btn sm secondary" onclick="designHub(${c.id}, '${esc(c.name).replace(/'/g, '')}')">🎨 ${c.wp_page_id ? 'Redesign' : 'Design'} hub page</button>
          <button class="btn sm secondary" onclick="addSpoke(${c.id}, '${esc(c.name).replace(/'/g, '')}')">+ Add spoke</button>
          <div class="spacer"></div>
          <button class="btn sm ghost" onclick="delCluster(${c.id})">Delete cluster</button>
        </div></div>`;
    }).join('') : '<div class="empty">No clusters yet. <a href="#" onclick="planClusters();return false">Plan hub &amp; spoke</a> from your keywords.</div>'}`;
};
// ---- Upload a keyword spreadsheet → propose hub & spoke clusters -----------
// Parses .xlsx/.xls/.csv in the browser (SheetJS), auto-detecting a keyword
// column (+ optional volume/difficulty), then asks the AI to organise them.
function parseKeywordFile(file) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) return reject(new Error('Spreadsheet parser is still loading — try again in a second.'));
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        if (!rows.length) return resolve([]);
        const header = (rows[0] || []).map((c) => String(c || '').toLowerCase().trim());
        const find = (re) => header.findIndex((h) => re.test(h));
        const kwIdx = find(/keyword|query|term|phrase/);
        const volIdx = find(/volume|searches|^sv$|monthly/);
        const kdIdx = find(/difficulty|^kd$|competition/);
        const hasHeader = kwIdx >= 0 || header.some((h) => /keyword|query|term|phrase|volume|difficulty/.test(h));
        const keyCol = kwIdx >= 0 ? kwIdx : 0;
        const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : undefined; };
        const out = [];
        for (let i = hasHeader ? 1 : 0; i < rows.length; i++) {
          const r = rows[i]; if (!r) continue;
          const kw = String(r[keyCol] ?? '').trim();
          if (!kw || kw.length < 2) continue;
          const item = { keyword: kw };
          if (volIdx >= 0) item.volume = num(r[volIdx]);
          if (kdIdx >= 0) item.difficulty = num(r[kdIdx]);
          out.push(item);
        }
        const seen = new Set(); const dedup = [];
        for (const it of out) { const k = it.keyword.toLowerCase(); if (!seen.has(k)) { seen.add(k); dedup.push(it); } }
        resolve(dedup);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
let _uploadPlan = null;
window.uploadKwFile = async () => {
  const f = $('#kwFile')?.files?.[0];
  const out = $('#kwUploadOut');
  if (!f) { toast('Choose an Excel or CSV file first', 'error'); return; }
  out.innerHTML = '<span class="spinner"></span> Reading the spreadsheet…';
  let keywords;
  try { keywords = await parseKeywordFile(f); }
  catch (e) { out.innerHTML = `<span class="badge failed">${esc(e.message)}</span>`; return; }
  if (!keywords.length) { out.innerHTML = '<span class="badge failed">No keywords found. Make sure a column holds the keywords.</span>'; return; }
  // Keep the request within the model's budget — use the top keywords (by volume
  // when available). The user can re-run on the rest, or raise the limit later.
  const CAP = 140;
  let note = '';
  if (keywords.length > CAP) {
    keywords = [...keywords].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, CAP);
    note = ` <span class="badge pending_review">using top ${CAP}${keywords[0]?.volume ? ' by volume' : ''}</span>`;
  }
  // Standalone path: group similar keywords + check against existing content,
  // then show a review (what's new, what's merged, what's already covered).
  const structure = $('#kwStructure')?.value || 'hubspoke';
  if (structure === 'standalone') {
    out.innerHTML = `Found <b>${keywords.length}</b> keyword(s)${note}. Grouping similar &amp; checking against your existing content…`;
    const t = toast('Analysing keywords…', 'loading');
    try {
      const a = await api.post('/articles/analyze-keywords', { keywords });
      _saAnalysis = a; _standalonePlan = a.create.slice();
      t.done(`${a.create.length} new · ${a.existing.length} already covered · ${a.mergedGroups} grouped`);
      out.innerHTML = `Analysed <b>${a.total}</b> keyword(s): <b>${a.create.length}</b> new, <b>${a.existing.length}</b> already covered, <b>${a.mergedGroups}</b> similar group(s) merged.`;
      renderStandaloneReview();
    } catch (e) { out.innerHTML = `<span class="badge failed">${esc(e.message)}</span>`; t.fail(e.message); }
    return;
  }
  out.innerHTML = `Found <b>${keywords.length}</b> keyword(s)${note}. Asking the AI to organise them into hubs &amp; spokes…`;
  const t = toast(`Clustering ${keywords.length} keywords into hubs & spokes…`, 'loading');
  try {
    const res = await api.post('/clusters/propose', {
      keywords,
      maxClusters: +$('#kwMaxClusters').value || 5,
      spokesPerCluster: +$('#kwSpokes').value || 6,
      intent: $('#kwIntent').value,
    });
    const plan = res.clusters || [];
    if (!plan.length) { out.innerHTML = '<span class="badge failed">The AI returned no clusters — try more keywords.</span>'; t.hide(); return; }
    // Flag keywords already covered on the site (the dedup guard skips them on create).
    let covered = new Set();
    try {
      const allKw = plan.flatMap((c) => [c.hub_keyword, ...(c.spokes || [])]).filter(Boolean);
      const chk = await api.post('/kwindex/check', { keywords: allKw });
      covered = new Set((chk.existing || []).map((x) => (x.keyword || '').toLowerCase()));
    } catch { /* non-fatal */ }
    _uploadPlan = plan;
    out.innerHTML = `Proposed <b>${plan.length}</b> cluster(s) from <b>${keywords.length}</b> keyword(s).`;
    t.done(`Proposed ${plan.length} cluster(s)`);
    renderUploadPlan(covered);
  } catch (e) { out.innerHTML = `<span class="badge failed">${esc(e.message)}</span>`; t.fail(e.message); }
};
function renderUploadPlan(covered = new Set()) {
  const cov = (kw) => covered.has((kw || '').toLowerCase());
  const body = `
    <p class="hint">Review the proposed structure — remove anything you don’t want, then create. Keywords marked <span class="badge failed">covered</span> already exist on your site and will be skipped automatically (duplicate guard).</p>
    <div id="upPlanBody">${_uploadPlan.map((c, ci) => `
      <div class="card" style="margin-bottom:12px">
        <div class="section-head" style="margin-bottom:8px">
          <h3 style="margin:0;font-size:14px">🏛 Hub: <input value="${esc(c.hub_keyword || '')}" oninput="upEditHub(${ci}, this.value)" style="display:inline-block;width:auto;min-width:240px;font-weight:600"/>
            ${cov(c.hub_keyword) ? '<span class="badge failed">covered</span>' : ''}</h3>
          <button class="btn sm ghost" onclick="upRemoveCluster(${ci})">✕ Remove cluster</button>
        </div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">Intent: ${esc(c.intent || 'informational')} · ${(c.spokes || []).length} spoke(s)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${(c.spokes || []).map((sp, si) => `<span class="badge ${cov(sp) ? 'failed' : ''}" style="padding:5px 10px">${esc(sp)} <span style="cursor:pointer;opacity:.7" onclick="upRemoveSpoke(${ci},${si})">✕</span></span>`).join('')}
        </div>
      </div>`).join('')}</div>
    <div class="inline" style="margin-top:14px;justify-content:flex-end">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn success" id="upCreateBtn" onclick="createUploadedPlan()">✓ Create ${_uploadPlan.length} cluster(s)</button>
    </div>`;
  modal('🧩 Proposed hubs & spokes', body);
  _uploadCovered = covered;
}
let _uploadCovered = new Set();
window.upEditHub = (ci, v) => { if (_uploadPlan[ci]) _uploadPlan[ci].hub_keyword = v; };
window.upRemoveSpoke = (ci, si) => { _uploadPlan[ci].spokes.splice(si, 1); renderUploadPlan(_uploadCovered); };
window.upRemoveCluster = (ci) => { _uploadPlan.splice(ci, 1); if (!_uploadPlan.length) { closeModal(); toast('Plan cleared', ''); return; } renderUploadPlan(_uploadCovered); };
window.kwStructureChange = () => {
  const hs = ($('#kwStructure')?.value || 'hubspoke') === 'hubspoke';
  $$('.hs-only').forEach((el) => { el.style.display = hs ? '' : 'none'; });
  const btn = $('#kwGoBtn'); if (btn) btn.innerHTML = hs ? '🧩 Analyze &amp; propose' : '🔍 Analyze keywords';
};
// Standalone review: groups of similar keywords merged + already-covered flagged.
let _standalonePlan = [];
let _saAnalysis = { existing: [], create: [], total: 0, mergedGroups: 0 };
function renderStandaloneReview() {
  const a = _saAnalysis;
  const mergedNote = (m) => (m && m.length) ? ` <span class="muted" style="font-size:11px">↩ merged: ${m.map(esc).join(', ')}</span>` : '';
  const existingBlock = a.existing.length ? `<div class="callout warn"><span class="ico">⚠️</span><div>
    <b>${a.existing.length} already covered</b> — these exist in your content and will be skipped (so you don’t cannibalise):
    <ul style="margin:6px 0 0;padding-left:18px;line-height:1.7">${a.existing.map((e) => `<li>${esc(e.keyword)} ${e.url ? `<a href="${esc(e.url)}" target="_blank" style="font-size:12px">↗ view</a>` : `<span class="muted" style="font-size:11px">(${esc(e.source)})</span>`}${mergedNote(e.merged)}</li>`).join('')}</ul></div></div>` : '';
  const list = _standalonePlan.length
    ? _standalonePlan.map((c, i) => `<div class="bulkbar" style="border-left-color:var(--accent-2);margin-bottom:6px"><span>${esc(c.keyword)}${c.volume ? ` <span class="muted" style="font-size:11px">vol ${fmtNum(c.volume)}</span>` : ''}${mergedNote(c.merged)}</span><div class="spacer"></div><button class="btn sm ghost" onclick="saRemove(${i})">✕</button></div>`).join('')
    : '<div class="empty">Nothing new to create — every keyword is already covered.</div>';
  modal('📄 Standalone articles — review', `
    <p class="hint">Similar keywords were grouped into a single article (anti-cannibalisation). Keywords already on your site are listed separately and won’t be recreated.</p>
    ${existingBlock}
    <div class="section-head" style="margin:14px 0 8px"><h3 style="margin:0;font-size:14px">✅ ${_standalonePlan.length} new standalone article(s) to create</h3></div>
    <div id="saList">${list}</div>
    <div class="inline" style="margin-top:14px;justify-content:flex-end">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      ${_standalonePlan.length ? `<button class="btn success" id="saCreateBtn" onclick="createStandalone()">✓ Create ${_standalonePlan.length} idea(s)</button>` : ''}
    </div>`);
}
window.saRemove = (i) => { _standalonePlan.splice(i, 1); renderStandaloneReview(); };
window.createStandalone = async () => {
  const t = toast('Creating standalone article ideas…', 'loading');
  await withBtn($('#saCreateBtn'), async () => {
    try {
      const r = await api.post('/articles/ideas', { keywords: _standalonePlan.map((c) => c.keyword) });
      t.done(`Created ${r.created.length} idea(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''} — open Content to generate`);
      closeModal(); navigate('articles');
    } catch (e) { t.fail(e.message); }
  });
};
window.createUploadedPlan = async () => {
  const t = toast('Creating clusters & queueing article ideas…', 'loading');
  await withBtn($('#upCreateBtn'), async () => {
    try {
      const r = await api.post('/clusters/create', { clusters: _uploadPlan });
      const made = r.created?.length || 0; const skip = r.skipped?.length || 0;
      t.done(`Created ${made} cluster(s)${skip ? `, skipped ${skip} same/similar keyword(s)` : ''} — spokes queued as ideas`);
      closeModal(); _uploadPlan = null; views.clusters();
    } catch (e) { t.fail(e.message); }
  });
};

window.publishClusterArticles = async (id) => {
  const arts = await api.get('/articles?cluster=' + id);
  const ready = arts.filter((a) => a.status === 'pending_review' || a.status === 'approved');
  if (!ready.length) return toast('Nothing ready to publish in this cluster', '');
  if (!confirm(`Approve & publish ${ready.length} article(s) to WordPress?`)) return;
  toast(`Publishing ${ready.length}…`);
  let ok = 0;
  for (const a of ready) { try { await api.post(`/articles/${a.id}/approve`, { publishNow: true }); ok++; } catch {} }
  toast(`Published ${ok}/${ready.length}`, 'success'); if (current === 'clusters') views.clusters();
};
window.addSpoke = (clusterId, clusterName) => {
  modal('Add spokes to “' + esc(clusterName) + '”', `
    <p class="hint">Add supporting articles to this cluster. Type your own, or let AI suggest winnable spokes — pick the ones you want.</p>
    <label class="field"><span>Spoke keywords (one per line)</span><textarea id="sp_kws" style="min-height:90px" placeholder="matrix rank explained&#10;how to compute a determinant"></textarea></label>
    <div class="inline" style="margin-bottom:10px">
      <button class="btn secondary" onclick="suggestSpokesAI(${clusterId})">✨ Suggest with AI</button>
      <label class="field" style="margin:0;display:flex;align-items:center;gap:6px;flex-direction:row"><input type="checkbox" id="sp_gen" style="width:auto"/> <span style="margin:0">Generate drafts immediately</span></label>
    </div>
    <div id="sp_suggestions"></div>
    <div class="inline" style="margin-top:10px"><button class="btn" onclick="doAddSpokes(${clusterId})">Add to cluster</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
};
window.suggestSpokesAI = async (clusterId) => {
  const box = $('#sp_suggestions');
  box.innerHTML = '<div class="empty"><span class="spinner"></span> Asking AI for spoke ideas…</div>';
  try {
    const r = await api.get(`/clusters/${clusterId}/suggest-spokes?count=8`);
    if (!r.spokes.length) { box.innerHTML = '<p class="muted">No suggestions returned.</p>'; return; }
    box.innerHTML = `<p class="hint" style="margin:0 0 6px">Suggested spokes — tick to include:</p>
      ${r.spokes.map((s, i) => `<label class="field" style="display:flex;flex-direction:row;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer"><input type="checkbox" class="sp_sug" value="${esc(s)}" style="width:auto" checked/> <span style="margin:0;font-size:13px">${esc(s)}</span></label>`).join('')}`;
  } catch (e) { box.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; }
};
window.doAddSpokes = async (clusterId) => {
  const typed = ($('#sp_kws').value || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const picked = $$('.sp_sug').filter((c) => c.checked).map((c) => c.value);
  const kws = [...new Set([...typed, ...picked])];
  if (!kws.length) return toast('Add or pick at least one spoke', 'error');
  const gen = $('#sp_gen').checked;
  closeModal();
  toast(`Adding ${kws.length} spoke(s)…`);
  let ok = 0;
  for (const k of kws) {
    try {
      const { id } = await api.post('/articles/idea', { keyword: k, role: 'spoke', clusterId });
      if (gen) await api.post(`/articles/${id}/generate`);
      ok++;
    } catch {}
  }
  toast(`Added ${ok} spoke(s)${gen ? ' (drafts generating)' : ''}`, 'success');
  if (current === 'clusters') views.clusters(); else if (current === 'strategy') loadStrategyPipeline();
};
window.delCluster = async (id) => { if (confirm('Delete cluster and its article ideas?')) { await api.del('/clusters/' + id); views.clusters(); } };
window.genClusterArticles = async (id) => {
  const arts = await api.get('/articles?cluster=' + id);
  const ideas = arts.filter((a) => a.status === 'idea');
  if (!ideas.length) return toast('No idea articles to generate in this cluster', '');
  generateBatch(ideas.map((a) => a.id), { title: 'Generating cluster articles', returnView: current === 'clusters' ? 'clusters' : 'articles' });
};
window.designHub = async (clusterId, name) => {
  toast('Designing hub page…');
  try { await api.post('/pages/design', { title: name, kind: 'hub', clusterId });
    toast('Hub page drafted — see Pages', 'success'); navigate('pages');
  } catch (e) { toast(e.message, 'error'); }
};

// ---- Articles -------------------------------------------------------------
let articleFilter = '';
let articlePage = 1;
let articleSearch = '';
const articleSel = new Set();
const ARTICLES_PER_PAGE = 15;
views.articles = async () => {
  const [all, clusters] = await Promise.all([
    api.get('/articles' + (articleFilter ? '?status=' + articleFilter : '')),
    api.get('/clusters').catch(() => []),
  ]);
  const filters = ['', 'idea', 'pending_review', 'approved', 'scheduled', 'published', 'failed'];
  const q = articleSearch.toLowerCase();
  const filtered = q ? all.filter((a) => (a.title || '').toLowerCase().includes(q) || (a.keyword || '').toLowerCase().includes(q)) : all;
  [...articleSel].forEach((id) => { if (!all.some((a) => a.id === id)) articleSel.delete(id); });

  // Group into clusters (hub + its spokes) and a standalone bucket.
  const byCluster = new Map();
  const standalone = [];
  for (const a of filtered) {
    if (a.cluster_id) { if (!byCluster.has(a.cluster_id)) byCluster.set(a.cluster_id, []); byCluster.get(a.cluster_id).push(a); }
    else standalone.push(a);
  }
  const clusterOf = (id) => clusters.find((c) => c.id === id);
  const head = `<tr><th class="chk"><input type="checkbox" onchange="toggleAllArticles(this)"/></th>
    <th>Keyword / Title</th><th>Role</th><th>SEO</th><th>Status</th><th></th></tr>`;
  const table = (rows) => `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;

  let groupsHtml = '';
  for (const [cid, arts] of byCluster) {
    const c = clusterOf(cid);
    const hub = arts.find((a) => a.role === 'hub');
    const spokes = arts.filter((a) => a.role !== 'hub');
    const ordered = [...(hub ? [hub] : []), ...spokes];
    const ready = arts.filter((a) => a.status === 'pending_review' || a.status === 'approved').length;
    const ideas = arts.filter((a) => a.status === 'idea' || a.status === 'failed').length;
    groupsHtml += `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--accent)">
      <div class="section-head" style="margin-bottom:10px">
        <h2 style="font-size:15px">🕸 ${esc(c ? (c.name || c.hub_keyword) : 'Cluster #' + cid)}
          <span class="muted" style="font-weight:400;font-size:12px"> · ${arts.length} article(s)${hub ? ` · hub “${esc(hub.keyword)}”` : ''}${c && c.wp_page_id ? ' · <span class="badge published">hub page live</span>' : ''}</span></h2>
        <div class="inline">
          ${ideas ? `<button class="btn sm secondary" onclick="clGen(${cid})">⚡ Generate ${ideas} draft(s)</button>` : ''}
          ${ready ? `<button class="btn sm success" onclick="clPublish(${cid})">⬆ Publish ${ready} ready</button>` : ''}
          <button class="btn sm ghost" onclick="navigate('clusters')">Open cluster ↗</button>
        </div>
      </div>
      ${table(ordered.map((a) => artRow(a, a.role === 'hub')).join(''))}
    </div>`;
  }
  const standaloneHtml = standalone.length
    ? `<div class="card"><div class="section-head" style="margin-bottom:10px"><h2 style="font-size:15px">📄 Standalone articles <span class="muted" style="font-weight:400;font-size:12px">· ${standalone.length}</span></h2></div>${table(standalone.map((a) => artRow(a, false)).join(''))}</div>`
    : '';

  $('#view').innerHTML = `
    ${pipelineFlow('articles')}
    <div class="card">
      <div class="toolbar">
        <input id="ideaKw" placeholder="Add an article idea (target keyword)…" style="min-width:240px" onkeydown="if(event.key==='Enter')addIdea()"/>
        <button class="btn secondary" onclick="addIdea()">+ Add idea</button>
        <button class="btn" onclick="goWorkflowCreate()">✨ New in Workflow</button>
        <div class="spacer"></div>
        <input type="search" id="artSearch" placeholder="Search title / keyword…" value="${esc(articleSearch)}" onkeydown="if(event.key==='Enter')artSearchGo()"/>
        <button class="btn sm" onclick="artSearchGo()">Search</button>
      </div>
      <div class="tabs">${filters.map((f) => `<div class="tab ${articleFilter === f ? 'active' : ''}" onclick="setArticleFilter('${f}')">${f ? f.replace(/_/g, ' ') : 'all'}</div>`).join('')}</div>
      <div id="bulkBar"></div>
      <p class="hint" style="margin:0">Spokes are grouped under their hub. Click a title to edit, 👁 to preview on your theme, or <b>Publish…</b> to choose how it appears.</p>
    </div>
    ${groupsHtml}${standaloneHtml}
    ${!filtered.length ? '<div class="empty">No articles match. Add an idea above, or create a cluster in the Workflow.</div>' : ''}`;
  renderBulkBar();
};
function artRow(a, isHub) {
  const titleLink = a.title
    ? `<a href="#" onclick="openArticle(${a.id});return false" style="color:var(--text);font-weight:600">${esc(a.title)}</a>`
    : `<span style="font-weight:600">${esc(a.keyword)}</span>`;
  const live = a.wp_url ? ` <a href="${esc(a.wp_url)}" target="_blank" title="Open the live post" style="font-size:12px;text-decoration:none">↗</a>` : '';
  const role = isHub ? '<span class="badge published">🏛 hub</span>' : badge(a.role);
  const warn = a.kw_warning ? `<br><span class="badge failed" title="${esc(a.kw_warning)}">⚠ duplicate keyword</span>` : '';
  const err = a.error ? `<br><span class="badge failed">${esc(a.error.slice(0, 60))}</span>` : '';
  const focus = a.focus_keyword ? `<span class="badge" style="font-size:10px;background:var(--accent-soft);color:var(--accent);margin-top:3px" title="Focus keyword">🎯 ${esc(a.focus_keyword)}</span>` : `<span class="muted" style="font-size:12px">${esc(a.keyword)}</span>`;
  return `<tr>
    <td class="chk"><input type="checkbox" data-aid="${a.id}" ${articleSel.has(a.id) ? 'checked' : ''} onchange="toggleArticle(${a.id},this)"/></td>
    <td style="${isHub ? '' : 'padding-left:24px'}">${titleLink}${live}<br>${focus}${warn}${err}</td>
    <td>${role}</td><td>${seoPill(a.seo_score)}</td><td>${badge(a.status)}</td>
    <td class="row-actions">${articleActions(a)}</td></tr>`;
}
function articleActions(a) {
  const primary = [];
  if (a.status === 'idea' || a.status === 'failed') primary.push(`<button class="btn sm" onclick="generateOne(${a.id},'articles')" title="Write the draft with AI">Generate</button>`);
  if (a.status === 'generating') primary.push(`<button class="btn sm" onclick="viewGen(${a.id})" title="View live generation progress"><span class="spinner"></span> View progress</button>`);
  if (a.content) primary.push(`<button class="btn sm secondary" onclick="previewArticle(${a.id})" title="See it on your theme">👁</button>`);
  if (a.status === 'pending_review' || a.status === 'approved') primary.push(`<button class="btn sm success" onclick="publishOptions(${a.id})" title="Choose how it appears">Publish…</button>`);
  const menu = [];
  menu.push({ label: '✏️ Open editor', onclick: `openArticle(${a.id})` });
  if (a.content) menu.push({ label: '👁 Preview on theme', onclick: `previewArticle(${a.id})` });
  if (a.content) menu.push({ label: '🔁 Regenerate', onclick: `generateOne(${a.id},'articles')` });
  if (a.status === 'pending_review' || a.status === 'approved') menu.push({ label: '⚡ Quick publish (defaults)', onclick: `publishArticle(${a.id})` });
  if (a.status === 'pending_review') menu.push({ label: '✅ Mark approved (no publish)', onclick: `artStatus(${a.id},'approved')` });
  menu.push({ label: '⧉ Duplicate', onclick: `dupArticle(${a.id})` });
  if (a.status === 'published' && a.wp_url) menu.push(
    { label: '🎯 Optimize CTR (GSC)', onclick: `wpOptimize('${esc(a.wp_url)}','ctr')` },
    { label: '📈 Refresh content (GSC)', onclick: `wpOptimize('${esc(a.wp_url)}','refresh')` },
    { label: '🧹 Reduce keyword density', onclick: `destuffPost('${esc(a.wp_url)}')` });
  if (a.status !== 'idea') menu.push({ label: '↩ Reset to idea', onclick: `artStatus(${a.id},'idea')` });
  if (a.wp_url) menu.push({ label: '↗ View on site', onclick: `window.open('${esc(a.wp_url)}','_blank')` });
  menu.push('-', { label: '🗑 Delete', onclick: `delArticle(${a.id})`, danger: true });
  return `${primary.join(' ')} ${actionMenu(menu)}`;
}
window.dupArticle = async (id) => { try { await api.post(`/articles/${id}/duplicate`, {}); toast('Duplicated — a new editable draft was created', 'success'); views.articles(); } catch (e) { toast(e.message, 'error'); } };
window.clGen = async (id) => { await genClusterArticles(id); if (current === 'articles') views.articles(); };
window.clPublish = async (id) => { await publishClusterArticles(id); if (current === 'articles') views.articles(); };
function renderBulkBar() {
  const bar = $('#bulkBar'); if (!bar) return;
  if (!articleSel.size) { bar.innerHTML = ''; return; }
  bar.innerHTML = `<div class="bulkbar"><span class="count">${articleSel.size} selected</span>
    <button class="btn sm" onclick="bulkArticles('generate')">Generate</button>
    <button class="btn sm success" onclick="bulkArticles('approve')">Approve &amp; publish</button>
    <button class="btn sm secondary" onclick="bulkArticles('publish')">Publish</button>
    <button class="btn sm danger" onclick="bulkArticles('delete')">Delete</button>
    <div class="spacer"></div><button class="btn sm ghost" onclick="clearArtSel()">Clear</button></div>`;
}
window.toggleArticle = (id, el) => { el.checked ? articleSel.add(id) : articleSel.delete(id); renderBulkBar(); };
window.toggleAllArticles = (el) => { $$('input[data-aid]').forEach((c) => { c.checked = el.checked; const id = +c.dataset.aid; el.checked ? articleSel.add(id) : articleSel.delete(id); }); renderBulkBar(); };
window.clearArtSel = () => { articleSel.clear(); views.articles(); };
window.bulkArticles = async (action) => {
  const ids = [...articleSel];
  if (!ids.length) return;
  // Generation gets the rich live panel.
  if (action === 'generate') { const batch = ids.slice(); articleSel.clear(); return generateBatch(batch, { title: 'Generating selected articles', returnView: 'articles' }); }
  if (action === 'delete' && !confirm(`Delete ${ids.length} article(s)?`)) return;
  toast(`${action} ${ids.length} article(s)…`);
  let ok = 0;
  for (const id of ids) {
    try {
      if (action === 'generate') await api.post(`/articles/${id}/generate`);
      else if (action === 'approve') await api.post(`/articles/${id}/approve`, { publishNow: true });
      else if (action === 'publish') await api.post(`/articles/${id}/publish`);
      else if (action === 'delete') await api.del('/articles/' + id);
      ok++;
    } catch (e) { /* continue */ }
  }
  toast(`Done: ${ok}/${ids.length}`, 'success');
  articleSel.clear(); views.articles();
};
window.artPage = (p) => { articlePage = p; views.articles(); };
window.artSearchGo = () => { articleSearch = $('#artSearch').value.trim(); articlePage = 1; views.articles(); };
window.artStatus = async (id, status) => { await api.post(`/articles/${id}/status`, { status }); toast(`Set to ${status}`, 'success'); views.articles(); };
window.setArticleFilter = (f) => { articleFilter = f; articlePage = 1; views.articles(); };
window.addIdea = async () => { const k = $('#ideaKw').value.trim(); if (!k) return; await api.post('/articles/idea', { keyword: k }); toast('Idea added','success'); views.articles(); };
window.genArticle = async (id) => { toast('Generating article (this can take ~30s)…'); try { await api.post(`/articles/${id}/generate`); toast('Draft ready','success'); views.articles(); } catch (e) { toast(e.message,'error'); views.articles(); } };
window.delArticle = async (id) => { if (confirm('Delete article?')) { await api.del('/articles/' + id); views.articles(); } };
// Publish/approve that respects the duplicate-keyword confirm gate. If the server
// refuses (DUPLICATE_KW), we surface the warning and let the owner confirm, then retry.
async function doPublishGuarded(path, id, body = {}) {
  try { await api.post(path, body); return true; }
  catch (e) {
    const msg = String(e.message || '');
    if (/DUPLICATE_KW/.test(msg)) {
      const detail = msg.replace(/^.*DUPLICATE_KW:\s*/, '');
      if (confirm(`⚠ Possible duplicate keyword\n\n${detail}\n\nPublish anyway and adopt this focus keyword?`)) {
        await api.post(path, { ...body, confirm: true });
        return true;
      }
      toast('Publishing cancelled — change the focus keyword or merge with the existing post.', 'error');
      return false;
    }
    throw e;
  }
}
window.publishArticle = async (id) => { toast('Publishing to WordPress…'); try { if (await doPublishGuarded(`/articles/${id}/publish`, id)) toast('Published!','success'); views.articles(); } catch (e) { toast(e.message,'error'); } };
window.approveArticle = async (id) => { toast('Approving & publishing…'); try { if (await doPublishGuarded(`/articles/${id}/approve`, id, { publishNow: true })) toast('Published!','success'); views.articles(); } catch (e) { toast(e.message,'error'); } };

// ---- Publish with appearance options (sourced live from the connected theme) --
let _pubCtx = null;
window.publishOptions = async (id) => {
  modal('⬆ Publish — choose how it appears', '<div class="loading-state"><span class="spinner spinner-lg"></span>Reading your theme’s publishing options from the live site…</div>');
  $('#modal .modal').classList.add('preview-modal');
  const [a, opts, theme] = await Promise.all([
    api.get('/articles/' + id),
    api.get('/wp/publish-options').catch(() => ({ statuses: [], categories: [], templates: [], layoutMeta: [] })),
    getTheme(),
  ]);
  _pubCtx = { id, a, theme, opts };
  const statuses = (opts.statuses || []).filter((s) => s.slug !== 'trash' && s.slug !== 'auto-draft' && s.slug !== 'inherit');
  const defStatus = a.status === 'scheduled' ? 'future' : (opts.defaults?.publish_status || 'publish');
  const opt = (arr, sel) => arr.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const layoutControls = (opts.layoutMeta || []).map((m) => `
    <label class="field"><span>${esc(m.label)} <span class="muted">(${esc(m.key)})</span></span>
      <select id="pub_meta_${esc(m.key)}" ${/sidebar/i.test(m.key) ? 'onchange="pubRefreshPreview()"' : ''}>
        ${opt(m.options, '')}</select></label>`).join('');

  modal('⬆ Publish — choose how it appears', `
    <p class="hint" style="margin-top:0">These options come straight from your connected site &amp; the active theme <b>${esc(themeVars(theme).name)}</b> — nothing is hard-coded. The preview updates as you change them.</p>
    <div class="grid cols-2" style="align-items:start;gap:22px">
      <div>
        <label class="field"><span>Status</span>
          <select id="pub_status" onchange="pubStatusChange()">
            ${statuses.map((s) => `<option value="${esc(s.slug)}" ${s.slug === defStatus ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
          </select></label>
        <label class="field" id="pub_dateRow" style="display:${defStatus === 'future' ? 'block' : 'none'}"><span>Publish date &amp; time</span>
          <input type="datetime-local" id="pub_date"/></label>
        ${opts.categories?.length ? `<label class="field"><span>Category</span>
          <select id="pub_cat">${opt([['', 'Default (from settings)'], ...opts.categories.map((c) => [String(c.id), c.name])], '')}</select></label>` : ''}
        ${opts.templates?.length ? `<label class="field"><span>Template</span>
          <select id="pub_template">${opt([['', 'Theme default'], ...opts.templates.map((t) => [t.slug, t.title])], '')}</select></label>` : ''}
        ${layoutControls}
        <label class="field"><span>Featured image</span>
          <select id="pub_img">${opt([['', 'Use my setting'], ['auto', 'Generate one with AI'], ['none', 'No featured image']], '')}</select></label>
        <label class="field"><span>Comments</span>
          <select id="pub_comments">${opt([['open', 'Allow comments'], ['closed', 'Closed']], 'open')}</select></label>
      </div>
      <div>
        <div class="muted" style="font-size:12px;margin-bottom:6px">👁 Live appearance preview (${esc(themeVars(theme).name)})</div>
        <div id="pubPreview" style="zoom:.6;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#fff">
          ${themePreviewBlock(theme, a.title || a.keyword, a.content, { sidebar: '' })}</div>
      </div>
    </div>
    <div class="inline" style="margin-top:16px;justify-content:flex-end">
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn success" id="pubGo" onclick="doPublishWithOptions(${id})">⬆ Publish now</button>
    </div>`);
  $('#modal .modal').classList.add('preview-modal');
  renderMath($('#pubPreview .wp-preview'));
};
window.pubStatusChange = () => {
  const s = $('#pub_status').value;
  $('#pub_dateRow').style.display = s === 'future' ? 'block' : 'none';
  const go = $('#pubGo');
  if (go) go.innerHTML = s === 'future' ? '🗓 Schedule' : s === 'draft' ? '💾 Save as draft' : '⬆ Publish now';
};
window.pubRefreshPreview = () => {
  if (!_pubCtx) return;
  const sidebar = $('#pub_meta_site-sidebar-layout')?.value
    || (_pubCtx.opts.layoutMeta || []).map((m) => /sidebar/i.test(m.key) ? document.getElementById('pub_meta_' + m.key)?.value : null).find(Boolean)
    || '';
  const el = $('#pubPreview');
  if (el) { el.innerHTML = themePreviewBlock(_pubCtx.theme, _pubCtx.a.title || _pubCtx.a.keyword, _pubCtx.a.content, { sidebar }); renderMath(el.querySelector('.wp-preview')); }
};
window.doPublishWithOptions = async (id) => {
  const status = $('#pub_status').value;
  const options = { status };
  if (status === 'future') {
    const d = $('#pub_date').value;
    if (!d) return toast('Pick a date & time to schedule.', 'error');
    options.scheduledDate = d.length === 16 ? d + ':00' : d; // datetime-local → WP local ISO
  }
  const cat = $('#pub_cat')?.value; if (cat) options.categoryId = cat;
  const tpl = $('#pub_template')?.value; if (tpl) options.template = tpl;
  const img = $('#pub_img')?.value; if (img) options.featuredImage = img;
  const com = $('#pub_comments')?.value; if (com) options.commentStatus = com;
  options.layoutMeta = {};
  (_pubCtx?.opts.layoutMeta || []).forEach((m) => { const v = document.getElementById('pub_meta_' + m.key)?.value; if (v) options.layoutMeta[m.key] = v; });
  const verb = status === 'future' ? 'Scheduling' : status === 'draft' ? 'Saving draft' : 'Publishing';
  const t = toast(`${verb} on WordPress…`, 'loading');
  await withBtn($('#pubGo'), async () => {
    try {
      if (await doPublishGuarded(`/articles/${id}/publish`, id, { options })) {
        t.done(status === 'future' ? 'Scheduled!' : status === 'draft' ? 'Saved as draft.' : 'Published!');
        closeModal(); views.articles();
      } else { t.hide(); }
    } catch (e) { t.fail(e.message); }
  });
};
// Open the full-page Article Editor (replaces the old modal). opts.generate
// auto-runs generation on open; opts.from sets where Back returns to.
let editingArticleId = null;
let articleReturnView = 'articles';
window.openArticle = async (id, opts = {}) => {
  editingArticleId = id;
  if (current !== 'article') articleReturnView = opts.from || current || 'articles';
  navigate('article'); // editor shows generation options + a prominent Generate button
};
window.viewArticle = (id) => window.openArticle(id); // back-compat for existing callers

views.article = async () => {
  if (!editingArticleId) { navigate(articleReturnView); return; }
  const id = editingArticleId;
  $('#view').innerHTML = '<div class="empty"><span class="spinner"></span> Loading…</div>';
  const [a, s] = await Promise.all([api.get('/articles/' + id), api.get('/settings')]);
  let cluster = null;
  if (a.cluster_id) cluster = await api.get('/clusters/' + a.cluster_id).catch(() => null);
  const faq = a.faq ? JSON.parse(a.faq) : [];
  const imgAlts = a.image_alts ? JSON.parse(a.image_alts) : [];
  const isLive = a.status === 'published' && a.wp_url;

  const actions = [];
  actions.push(`<button class="btn" onclick="saveArticle(${id})">💾 Save &amp; re-check</button>`);
  if (a.status === 'idea' || a.status === 'failed' || !a.content) actions.push(`<button class="btn success" onclick="genInEditor(${id})">✨ Generate draft</button>`);
  else actions.push(`<button class="btn secondary" onclick="genInEditor(${id})">🔁 Regenerate</button>`);
  if (a.status === 'pending_review') actions.push(`<button class="btn success" onclick="edApprove(${id})">✅ Approve &amp; publish</button>`);
  if (a.status === 'approved') actions.push(`<button class="btn success" onclick="edPublish(${id})">⬆ Publish</button>`);
  if (isLive) actions.push(`<button class="btn secondary" onclick="wpOptimize('${esc(a.wp_url)}','refresh')">📈 Refresh (GSC)</button>`,
    `<button class="btn secondary" onclick="wpOptimize('${esc(a.wp_url)}','ctr')">🎯 Improve CTR</button>`,
    `<button class="btn secondary" onclick="destuffPost('${esc(a.wp_url)}')">🧹 Reduce density</button>`);

  $('#view').innerHTML = `
    <div class="toolbar">
      <button class="btn sm ghost" onclick="navigate(articleReturnView)">← Back</button>
      <div><b style="font-size:15px">${esc(a.title || a.keyword)}</b> ${badge(a.status)} ${seoPill(a.seo_score)}</div>
      <div class="spacer"></div>
      ${a.wp_url ? `<a class="btn sm ghost" href="${esc(a.wp_url)}" target="_blank">View on site ↗</a>` : ''}
      <button class="btn sm danger" onclick="edDelete(${id})">Delete</button>
    </div>
    ${cluster ? `<div class="bulkbar"><span style="font-size:13px">🕸 Cluster: <b>${esc(cluster.name)}</b> · role <b>${esc(a.role)}</b> · hub “${esc(cluster.hub_keyword)}”</span>
      <div class="spacer"></div><button class="btn sm ghost" onclick="navigate('clusters')">Open cluster ↗</button></div>` : ''}
    ${a.kw_warning ? `<div class="card" style="border-color:var(--danger);background:var(--bg)">
      <b style="color:var(--danger)">⚠ Duplicate focus keyword</b>
      <p style="font-size:13px;margin:6px 0">${esc(a.kw_warning)}</p>
      <div class="inline"><button class="btn sm" onclick="confirmKw(${id})">✓ Confirm keyword is OK</button>
        <span class="muted" style="font-size:12px">…or change the Focus keyword below &amp; Save. Publishing is blocked until resolved.</span></div></div>` : ''}
    <div class="grid cols-2" style="align-items:start">
      <div class="card">
        <h3>Content</h3>
        <div class="grid cols-2">
          <label class="field"><span>Focus keyword</span><input id="ed_focus" value="${esc(a.focus_keyword || a.keyword || '')}"/></label>
          <label class="field"><span>Tags (comma-separated)</span><input id="ed_tags" value="${esc(a.tags || '')}"/></label>
        </div>
        <label class="field"><span>SEO title</span><input id="ed_title" value="${esc(a.title || '')}"/></label>
        <div class="grid cols-2">
          <label class="field"><span>Slug</span><input id="ed_slug" value="${esc(a.slug || '')}"/></label>
          <label class="field"><span>Status</span><input value="${esc(a.status)}" disabled/></label>
        </div>
        <label class="field"><span>Meta description</span><textarea id="ed_meta" style="min-height:60px">${esc(a.meta_description || '')}</textarea></label>
        <label class="field"><span>Content (Gutenberg blocks)</span><textarea id="ed_content" style="min-height:420px;font-family:ui-monospace,monospace;font-size:12px">${esc(a.content || '')}</textarea></label>
      </div>
      <div>
        <div id="seoPanel" class="card"><span class="spinner"></span> Checking SEO…</div>
        ${faq.length ? `<div class="card" style="margin-top:16px"><h3>FAQ (${faq.length})</h3>${faq.map((f) => `<p style="font-size:13px;margin:4px 0"><b>${esc(f.q)}</b><br><span class="muted">${esc(f.a)}</span></p>`).join('')}</div>` : ''}
        ${imgAlts.length ? `<div class="card" style="margin-top:16px"><h3>Suggested image alts</h3>${imgAlts.map((x) => `<span class="badge" style="margin:2px">${esc(x)}</span>`).join('')}</div>` : ''}
        ${a.error ? `<div class="card" style="margin-top:16px;border-color:var(--danger)"><b>Last error</b><p class="muted" style="font-size:12px">${esc(a.error)}</p></div>` : ''}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <details ${(!a.content || a.status === 'idea' || a.status === 'failed') ? 'open' : ''}>
        <summary>⚙️ Generation options — override defaults for THIS article</summary>
        <div style="margin-top:10px">
          <div class="grid cols-2">
            <label class="field"><span>Target words (min)</span><input id="gen_wmin" type="number" value="${esc(s.words_min || '')}"/></label>
            <label class="field"><span>Target words (max)</span><input id="gen_wmax" type="number" value="${esc(s.words_max || '')}"/></label>
          </div>
          <label class="field"><span>Tone</span><input id="gen_tone" value="${esc(s.tone || '')}"/></label>
          <label class="field"><span>Angle / search intent (optional)</span><input id="gen_angle" placeholder="e.g. beginner tutorial with worked numpy example / comparison / buyer guide"/></label>
          <label class="field"><span>Extra instructions for this article (optional)</span><textarea id="gen_instr" placeholder="e.g. add a step-by-step example and a comparison table; cite 2 academic sources"></textarea></label>
        </div>
      </details>
      <div class="inline" style="flex-wrap:wrap;margin-top:6px">${actions.join('')}
        ${a.content ? `<button class="btn" onclick="previewArticle(${id})">👁 Preview</button>` : ''}
        <button class="btn secondary" onclick="analyzePost(${id})">🔬 Analyze: gaps, hub, links, backlinks</button></div>
    </div>
    <div id="intelPanel"></div>`;
  loadSeo(id, a.wp_post_id);
  loadIntel(id); // re-show the saved SERP gap analysis (persists across navigation)
};
// Render a (persisted or fresh) SERP content-gap analysis into #intelPanel.
function renderIntel(d, id) {
  window.__intel = d;
  const list = (arr) => `<ul style="margin:4px 0">${(arr || []).map((x) => `<li style="font-size:13px">${esc(typeof x === 'string' ? x : (x.step || x))}</li>`).join('')}</ul>`;
  const hp = d.hubPotential || {};
  const prio = (p) => p === 'high' ? '<span class="badge failed">high</span>' : p === 'low' ? '<span class="badge">low</span>' : '<span class="badge pending_review">medium</span>';
  const cov = d.coverageScore != null ? `<span class="badge ${d.coverageScore >= 70 ? 'published' : d.coverageScore >= 40 ? 'pending_review' : 'failed'}" title="How completely this page covers the topic vs the top 10">coverage ${d.coverageScore}/100</span>` : '';
  const words = d.myWordCount != null ? `<span class="muted" style="font-size:12px">${d.myWordCount} words vs top-10 avg ${d.avgCompetitorWords || '?'}${d.targetWordCount ? ` · aim ${d.targetWordCount}` : ''}</span>` : '';
  const improvements = (d.improvements || []);
  // Live-post analyses (from WordPress) carry the URL but no draft id — they get
  // URL-based actions (regenerate the live post, insert links into it).
  const url = (d.target && d.target.wp_url) || null;
  return `<div class="card" style="margin-top:16px">
      <div class="section-head"><h2>🔬 SERP content-gap analysis — “${esc(d.keyword)}”</h2>
        <div class="inline" style="gap:8px">${cov}${id ? `<button class="btn sm secondary" onclick="analyzePost(${id})">🔄 Re-analyze</button>` : url ? `<button class="btn sm secondary" onclick="wpAnalyzeUrl('${esc(url)}')">🔄 Re-analyze</button>` : ''}</div></div>
      <p class="muted" style="font-size:12px;margin:-4px 0 10px">${d.scrapedCount || 0}/${d.competitors?.length || 0} top-ranking Google pages scraped${d.analyzedAt ? ` · last analysed ${esc(d.analyzedAt)} UTC` : ''} · ${words}</p>
      ${(d.competitors || []).length ? `<details style="margin:0 0 12px" open><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--accent)">🔍 Live Google top-10 for “${esc(d.keyword)}” (real SERP via Ahrefs)</summary>
        <ol class="table-scroll" style="max-height:220px;margin:8px 0;padding:8px 8px 8px 28px">${d.competitors.slice(0, 10).map((cp) => `<li style="font-size:12.5px;margin-bottom:4px"><a href="${esc(cp.url)}" target="_blank" rel="noopener">${esc((cp.title || cp.url).slice(0, 85))}</a> <span class="muted">— pos ${esc(cp.position ?? '?')}${cp.dr != null ? `, DR ${esc(cp.dr)}` : ''}${cp.traffic != null ? `, ~${esc(cp.traffic)} visits/mo` : ''}</span></li>`).join('')}</ol></details>` : '<p class="callout warn" style="font-size:12.5px"><span class="ico">⚠️</span><div>No live SERP returned — check the Ahrefs connection. Recommendations below fall back to model knowledge (not the live top-10).</div></p>'}
      ${improvements.length ? `<div class="callout" style="background:var(--accent-soft);border-color:var(--accent)"><div style="flex:1">
        <h3 style="margin:0 0 8px">✍️ Recommended edits — what the top 10 cover that you don't</h3>
        <table><thead><tr><th>Add this section</th><th>What to cover</th><th>In top-10</th><th>Priority</th></tr></thead><tbody>
        ${improvements.map((i) => `<tr><td><b>${esc(i.heading || '')}</b></td><td class="muted" style="font-size:12px">${esc(i.what || '')}</td><td style="text-align:center">${i.competitorsCovering != null ? esc(i.competitorsCovering) + '/10' : '—'}</td><td>${prio(i.priority)}</td></tr>`).join('')}
        </tbody></table>
        ${id ? `<button class="btn success" style="margin-top:10px" onclick="applyImprovements(${id})">✍️ Apply these edits to the draft (AI)</button>
        <span class="muted" style="font-size:11px;margin-left:8px">Rewrites the draft to add the missing sections, then re-scores.</span>`
          : url ? `<button class="btn success" style="margin-top:10px" onclick="optimizeLive('${esc(url)}','regenerate')">♻️ Regenerate this post with these edits</button>
        <span class="muted" style="font-size:11px;margin-left:8px">Rewrites the live post incorporating these gaps + rich components — you review &amp; apply.</span>`
          : '<p class="muted" style="font-size:11px;margin-top:6px">Open the matching draft in Content to apply these edits automatically.</p>'}
      </div></div>` : ''}
      <div class="grid cols-2" style="align-items:start;margin-top:8px">
        <div>
          <h3>🧩 Content gaps</h3>${(d.contentGaps || []).length ? list(d.contentGaps) : '<p class="muted">None found.</p>'}
          ${(d.missingEntities || []).length ? `<h3 style="margin-top:12px">🔑 Missing terms/entities</h3><p>${d.missingEntities.map((m) => `<span class="badge" style="margin:2px">${esc(m)}</span>`).join('')}</p>` : ''}
          <h3 style="margin-top:12px">💡 Where you can beat them</h3>${(d.competitorsLack || []).length ? list(d.competitorsLack) : '<p class="muted">—</p>'}
        </div>
        <div>
          <h3>🏛 Hub potential</h3>
          ${hp.canBeHub
            ? `<p style="font-size:13px"><span class="badge approved">Could be a hub</span> ${esc(hp.reason || '')}</p>
               ${(hp.suggestedSpokes || []).length ? `<p style="font-size:13px">Suggested spokes: ${hp.suggestedSpokes.map((s) => `<span class="badge" style="margin:2px">${esc(s)}</span>`).join('')}</p>
               ${id ? `<button class="btn sm success" onclick='convertToHub(${id})'>🏛 Convert to hub + add ${hp.suggestedSpokes.length} spokes</button>` : ''}` : ''}`
            : `<p class="muted" style="font-size:13px">${esc(hp.reason || 'Better as a single focused article.')}</p>`}
          ${(d.scraped || []).length ? `<h3 style="margin-top:12px">🌐 Top-ranking pages scraped</h3><ol style="margin:4px 0;padding-left:20px">${d.scraped.slice(0, 10).map((s) => `<li style="font-size:12px"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc((s.title || s.url).slice(0, 70))}</a> <span class="muted">(${s.wordCount} words)</span></li>`).join('')}</ol>` : ''}
        </div>
      </div>
      <h3 style="margin-top:14px">🔗 Genuine backlink steps</h3>
      ${(d.backlinkSteps || []).length ? `<table><thead><tr><th>Tactic</th><th>Step</th><th>Target</th></tr></thead><tbody>
        ${d.backlinkSteps.map((b) => `<tr><td><b>${esc(b.tactic || '')}</b></td><td class="muted" style="font-size:12px">${esc(b.step || '')}</td><td class="muted" style="font-size:12px">${esc(b.target || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">—</p>'}
      <h3 style="margin-top:14px">🕸 Internal links to add</h3>
      ${(d.internalLinks || []).length ? `${d.internalLinks.map((l, i) => `<label class="field" style="display:flex;flex-direction:row;align-items:center;gap:8px;margin-bottom:4px"><input type="checkbox" class="il_pick" data-i="${i}" style="width:auto" checked/>
          <span style="margin:0;font-size:13px"><b>${esc(l.anchor || '')}</b> → ${esc(l.toTitle || l.toUrl)} <span class="muted">— ${esc(l.why || '')}</span></span></label>`).join('')}
        ${id ? `<button class="btn sm success" onclick="insertLinks(${id})">Insert selected links</button>` : url ? `<button class="btn sm success" onclick="insertLinksUrl('${esc(url)}')">Insert selected links into the live post</button>` : ''}` : '<p class="muted">No internal-link opportunities found.</p>'}
    </div>`;
}
// Load the PERSISTED analysis on editor open (survives navigation); show a prompt if none.
async function loadIntel(id) {
  const el = $('#intelPanel'); if (!el) return;
  let d = null;
  try { d = await api.get(`/articles/${id}/analysis`); } catch { /* */ }
  if (d && d.keyword) el.innerHTML = renderIntel(d, id);
  else el.innerHTML = `<div class="card" style="margin-top:16px"><div class="section-head"><h2>🔬 SERP content-gap analysis</h2></div>
      <p class="muted" style="font-size:13px">See exactly what Google's top 10 results cover for your focus keyword that this article doesn't — with apply-ready edits. Click <b>🔬 Analyze</b> above (~20–40s). Results are saved and reappear here whenever you return.</p></div>`;
}
window.analyzePost = async (id) => {
  const el = $('#intelPanel');
  el.innerHTML = '<div class="card" style="margin-top:16px"><div class="empty"><span class="spinner"></span> Searching Google’s top 10 &amp; scraping their content (~20-40s)…</div></div>';
  let d;
  try { d = await api.post(`/articles/${id}/analyze`); }
  catch (e) { el.innerHTML = `<div class="card" style="margin-top:16px"><p class="badge failed">${esc(e.message)}</p></div>`; return; }
  el.innerHTML = renderIntel(d, id);
};
window.applyImprovements = async (id) => {
  if (!confirm('Rewrite this draft to add the missing sections the top 10 cover? Your current content is kept and expanded.')) return;
  toast('Applying improvements (AI is editing the draft)…');
  try { const r = await api.post(`/articles/${id}/apply-improvements`); toast(`Applied ${r.applied} improvements — new score ${r.seo_score}`, 'success'); views.article(); }
  catch (e) { toast(e.message, 'error'); }
};
window.convertToHub = async (id) => {
  const spokes = (window.__intel?.hubPotential?.suggestedSpokes) || [];
  if (!confirm(`Convert this article into a hub? It will check each of the ${spokes.length} suggested spokes against what you've already published, generate only the missing ones, and link the rest.`)) return;
  try {
    const r = await api.post(`/articles/${id}/convert-to-hub`, { spokes });
    const ex = r.existingLinked || 0;
    let msg = `Hub created · ${r.spokesAdded} new spoke(s) to generate`;
    if (ex) msg += ` · ${ex} already published → linked (not duplicated)`;
    toast(msg, 'success');
    if (ex && Array.isArray(r.existing) && r.existing.length) {
      // Show which existing posts were linked so the user sees the dedup at work.
      modal('🕸 Hub created — existing spokes linked, not duplicated', `
        <p class="muted" style="font-size:13px">Created the hub and <b>${r.spokesAdded}</b> idea(s) for the genuinely missing topics. These suggested spokes <b>already exist</b>, so they were linked into the cluster instead of regenerated — the hub will interlink to them:</p>
        <table><thead><tr><th>Existing spoke</th><th>Where</th></tr></thead><tbody>
        ${r.existing.map((e) => `<tr><td>${esc(e.title || e.keyword)}</td><td>${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.source || 'live')} ↗</a>` : esc(e.source || 'your content')}</td></tr>`).join('')}
        </tbody></table>
        <div class="inline" style="margin-top:12px"><button class="btn" onclick="closeModal();navigate('clusters')">Open the cluster →</button><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
    }
    views.article();
  }
  catch (e) { toast(e.message, 'error'); }
};
window.insertLinks = async (id) => {
  const picks = $$('.il_pick').filter((c) => c.checked).map((c) => window.__intel.internalLinks[+c.dataset.i]);
  if (!picks.length) return toast('Select at least one link', 'error');
  try { const r = await api.post(`/articles/${id}/insert-links`, { links: picks }); toast(`Inserted ${r.total} internal link(s)`, 'success'); views.article(); }
  catch (e) { toast(e.message, 'error'); }
};
// Insert the chosen internal links straight into the LIVE WordPress post (URL-based).
window.insertLinksUrl = async (url) => {
  const picks = $$('.il_pick').filter((c) => c.checked).map((c) => window.__intel.internalLinks[+c.dataset.i]);
  if (!picks.length) return toast('Select at least one link', 'error');
  const t = toast('Inserting links into the live post…', 'loading');
  try { const r = await api.post('/intel/insert-links', { url, links: picks }); t.done(`Inserted ${r.total} internal link(s) into the live post`, 'success'); }
  catch (e) { t.fail(e.message); }
};
async function genInEditor(id) {
  // Collect the per-article generation options the user set (blank = use defaults).
  const val = (k) => { const el = $('#' + k); return el ? el.value.trim() : ''; };
  const opts = {};
  if (val('gen_wmin')) opts.words_min = val('gen_wmin');
  if (val('gen_wmax')) opts.words_max = val('gen_wmax');
  if (val('gen_tone')) opts.tone = val('gen_tone');
  if (val('gen_angle')) opts.angle = val('gen_angle');
  if (val('gen_instr')) opts.instructions = val('gen_instr');
  // Show the rich live panel (returns to this editor when done).
  generateBatch([id], { options: opts, title: 'Generating draft', returnView: 'article' });
}
window.genInEditor = genInEditor;
// Generate a single article via the live panel (used by every "Generate" row button).
window.generateOne = (id, ret) => generateBatch([id], { title: 'Generating article', returnView: ret || (current === 'article' ? articleReturnView : (current || 'articles')) });
window.edApprove = async (id) => { toast('Approving & publishing…'); try { if (await doPublishGuarded(`/articles/${id}/approve`, id, { publishNow: true })) toast('Published!', 'success'); views.article(); } catch (e) { toast(e.message, 'error'); } };
window.edPublish = async (id) => { toast('Publishing…'); try { if (await doPublishGuarded(`/articles/${id}/publish`, id)) toast('Published!', 'success'); views.article(); } catch (e) { toast(e.message, 'error'); } };
window.confirmKw = async (id) => { try { await api.post(`/articles/${id}/confirm-kw`, {}); toast('Keyword confirmed — you can publish now', 'success'); views.article(); } catch (e) { toast(e.message, 'error'); } };
window.edDelete = async (id) => { if (!confirm('Delete this article?')) return; await api.del('/articles/' + id); toast('Deleted', 'success'); navigate(articleReturnView); };

// Placeholder shown for the not-yet-generated hero image in a draft preview.
const HERO_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='420'%3E%3Crect width='100%25' height='100%25' fill='%23eef2f7'/%3E%3Ctext x='50%25' y='50%25' fill='%238b97a6' font-family='sans-serif' font-size='30' text-anchor='middle' dominant-baseline='middle'%3EFeatured image (added on publish)%3C/text%3E%3C/svg%3E";

// Render the article as it will look on WordPress, with LaTeX math via KaTeX.
// ---- Shared theme-accurate preview ----------------------------------------
// Renders Gutenberg content the way it will look on the CONNECTED theme — using
// the theme's real primary colour, heading/body fonts and container width
// (all pulled dynamically via /theme; nothing hard-coded). Optionally simulates
// a sidebar layout so the user sees exactly how their chosen layout appears.
let _themeProfile = null;
async function getTheme() {
  if (_themeProfile !== null) return _themeProfile;
  try { _themeProfile = await api.get('/theme'); } catch { _themeProfile = null; }
  return _themeProfile;
}
function themeVars(t) {
  const pal = t?.palette || [];
  const pri = pal.find((c) => /primary|accent|brand/i.test(c.name))?.hex || t?.tokens?.colors?.[0] || '#2563eb';
  return {
    pri,
    hfont: t?.fonts?.heading || 'Inter, system-ui, sans-serif',
    bfont: t?.fonts?.body || 'Georgia, serif',
    width: t?.containerWidth || t?.tokens?.containerWidth || '1080px',
    name: t?.theme || 'your theme',
  };
}
// Returns the `.wp-preview` block (scoped style + content). `sidebar` = '' |
// 'no-sidebar' | 'left-sidebar' | 'right-sidebar' to simulate the theme layout.
function themePreviewBlock(theme, title, contentHtml, { sidebar = '' } = {}) {
  const v = themeVars(theme);
  const body = (contentHtml || '').replace(/\{\{HERO_IMAGE\}\}/g, HERO_PLACEHOLDER);
  const hasSidebar = sidebar && sidebar !== 'no-sidebar' && sidebar !== '';
  const widget = (t) => `<div class="tp-widget"><b>${t}</b><div class="tp-w-line"></div><div class="tp-w-line"></div></div>`;
  const aside = hasSidebar ? `<aside class="tp-side">${widget('Search')}${widget('Recent posts')}${widget('Categories')}</aside>` : '';
  return `<div class="wp-preview tp-root ${hasSidebar ? 'tp-has-side ' + sidebar : ''}" style="--pri:${esc(v.pri)};--hf:${esc(v.hfont)};--bf:${esc(v.bfont)};max-width:${esc(v.width)}">
    <style scoped>
      .tp-root { font-family: var(--bf); }
      .tp-root h1,.tp-root h2,.tp-root h3,.tp-root h4 { font-family: var(--hf); }
      .tp-root h1 { color: var(--pri); }
      .tp-root a { color: var(--pri); }
      .tp-root .wp-block-button__link, .tp-root .wp-element-button { display:inline-block; background:var(--pri); color:#fff !important; padding:10px 18px; border-radius:5px; font-weight:600; text-decoration:none; }
      .tp-root .wp-block-cover { background:linear-gradient(135deg,var(--pri),#1f2937); color:#fff; padding:48px 32px; border-radius:8px; margin:16px 0; text-align:center; }
      .tp-root .wp-block-cover :is(h1,h2,h3,p){ color:#fff; }
      .tp-root .wp-block-columns { display:grid; gap:24px; grid-template-columns:repeat(var(--cols,2),1fr); margin:24px 0; }
      .tp-root .wp-block-column { background:#fafafa; padding:18px; border-radius:6px; border:1px solid #eee; }
      .tp-root .wp-block-separator { border:0; border-top:1px solid #eee; margin:24px 0; }
      .tp-root .wp-block-buttons { display:flex; gap:10px; flex-wrap:wrap; margin:12px 0; }
      .tp-root.tp-has-side { display:grid; gap:34px; grid-template-columns:1fr 250px; }
      .tp-root.left-sidebar { grid-template-columns:250px 1fr; }
      .tp-root.left-sidebar .tp-main { order:2; }
      .tp-side { font-family: var(--bf); }
      .tp-widget { background:#f6f8fa; border:1px solid #eef1f4; border-radius:8px; padding:14px; margin-bottom:14px; font-size:13px; color:#566; }
      .tp-widget b { color:#222; font-family:var(--hf); display:block; margin-bottom:8px; }
      .tp-w-line { height:8px; background:#e6eaef; border-radius:4px; margin:7px 0; }
      .tp-w-line:last-child { width:60%; }
    </style>
    <article class="tp-main"><h1>${esc(title || '')}</h1>${body}</article>${aside}
  </div>`;
}
window.previewArticle = async (id) => {
  const [a, theme] = await Promise.all([api.get('/articles/' + id), getTheme()]);
  modal(`👁 Preview — ${a.title || a.keyword}`, `
    ${themePreviewBlock(theme, a.title || a.keyword, a.content)}
    <p class="preview-note">Rendered with <b>${esc(themeVars(theme).name)}</b>’s real colours &amp; fonts · LaTeX via KaTeX. The live theme may add its header/footer; use “Publish…” to choose layout &amp; see it on the site.</p>
    <div class="inline" style="margin-top:12px;justify-content:flex-end">
      <button class="btn secondary" onclick="closeModal();openArticle(${id})">✏️ Edit</button>
      ${a.status === 'approved' || a.status === 'pending_review' ? `<button class="btn success" onclick="closeModal();publishOptions(${id})">⬆ Publish…</button>` : ''}
      <button class="btn ghost" onclick="closeModal()">Close</button>
    </div>`);
  $('#modal .modal').classList.add('preview-modal');
  renderMath($('#modalBody .wp-preview'));
};
function renderMath(el) {
  if (!el) return;
  const go = () => {
    if (!window.renderMathInElement) return false;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* ignore */ }
    return true;
  };
  if (!go()) { let n = 0; const t = setInterval(() => { if (go() || ++n > 20) clearInterval(t); }, 150); } // wait for KaTeX CDN
}
const seoColor = (n) => (n >= 80 ? 'var(--accent-2)' : n >= 50 ? 'var(--warn)' : 'var(--danger)');
async function loadSeo(id, wpPostId) {
  const el = $('#seoPanel');
  if (!el) return;
  try {
    const r = await api.get(`/articles/${id}/seo`);
    const groups = {};
    r.checks.forEach((c) => (groups[c.group] = groups[c.group] || []).push(c));
    // If published, also fetch the REAL Rank Math score from WordPress.
    let liveBadge = '';
    if (wpPostId) {
      try {
        const rm = await api.get(`/wp/rankmath/${wpPostId}`);
        liveBadge = rm.score != null
          ? `<span class="badge published" title="Live score from the Rank Math plugin">Rank Math (live): ${rm.score}/100</span>`
          : '<span class="badge" title="Enable Rank Math → score storage + REST to read the live score">Rank Math (live): n/a</span>';
      } catch { liveBadge = ''; }
    }
    el.innerHTML = `<div class="section-head" style="margin-bottom:8px">
        <h2 style="font-size:14px">Rank Math score</h2>
        <span><span class="stat" style="font-size:22px;color:${seoColor(r.score)}">${r.score}/100</span> <span class="muted" style="font-size:11px">est.</span> ${liveBadge}</span></div>
      <p class="hint" style="margin:0 0 8px">Weighted exactly like Rank Math · ${r.passed}/${r.total} tests · ${r.words} words · density ${r.density}% · ${r.internal} internal / ${r.external} external links</p>
      ${Object.entries(groups).map(([g, items]) => `<div style="margin-bottom:6px"><b style="font-size:12px;color:var(--muted)">${esc(g)}</b><br>
        ${items.map((c) => `<span style="display:inline-block;margin:2px 6px 2px 0;font-size:12px" title="weight ${c.weight}">${c.pass ? '✅' : '⚠️'} ${esc(c.label)}</span>`).join('')}</div>`).join('')}`;
  } catch (e) { el.innerHTML = `<span class="badge failed">${esc(e.message)}</span>`; }
}
window.saveArticle = async (id) => {
  await api.put('/articles/' + id, {
    title: $('#ed_title').value, slug: $('#ed_slug').value, meta_description: $('#ed_meta').value,
    focus_keyword: $('#ed_focus').value, tags: $('#ed_tags').value, content: $('#ed_content').value,
  });
  toast('Saved','success');
  loadSeo(id, editingArticleId === id ? undefined : undefined);
  if (current !== 'article') views.articles();
};

// ---- Autopilot — the 24/7 engine control room -----------------------------
views.autopilot = async () => {
  $('#view').innerHTML = '<div class="empty"><span class="spinner"></span> Loading autopilot…</div>';
  const [queue, cal, rank, idx, dist] = await Promise.all([
    api.get('/autopilot/queue').catch(() => null),
    api.get('/autopilot/calendar').catch(() => null),
    api.get('/ranktrack/summary').catch(() => null),
    api.get('/indexmon/summary').catch(() => null),
    api.get('/distribute/status').catch(() => null),
  ]);
  const on = (b) => b ? '<span class="badge published">on</span>' : '<span class="badge failed">off</span>';
  const yn = (b) => b ? '✅' : '⚠️';

  const queueCard = `<div class="card">
    <div class="section-head"><h3>♻️ Idea queue (self-replenish)</h3>${on(queue?.autoReplenish)}</div>
    <div class="stat">${queue ? queue.ideas : '—'}<span class="muted" style="font-size:13px"> ideas queued</span></div>
    <p class="muted" style="font-size:13px">Auto-refills when below <b>${queue?.minIdeas ?? '—'}</b> using GSC gaps → Ahrefs → AI.</p>
    <div class="inline"><button class="btn sm" onclick="apReplenish()">＋ Replenish now</button>
      <button class="btn sm ghost" onclick="navigate('settings')">Configure</button></div>
    <div id="apReplenishOut" class="muted" style="font-size:12px;margin-top:6px"></div></div>`;

  const upcoming = (cal?.upcoming || []);
  const calCard = `<div class="card">
    <div class="section-head"><h3>🗓 Editorial calendar</h3><span class="badge ${cal?.cadence === 'scheduled' ? 'published' : ''}">${esc(cal?.cadence || '—')}</span></div>
    <p class="muted" style="font-size:13px">Publish times: <code>${esc(cal?.times || '—')}</code></p>
    ${upcoming.length ? `<table><thead><tr><th>When</th><th>Title</th></tr></thead><tbody>
      ${upcoming.slice(0, 8).map((u) => `<tr><td class="muted" style="font-size:12px;white-space:nowrap">${esc((u.scheduled_for || '').replace('T', ' ').slice(0, 16))}</td><td>${esc(u.title || u.keyword)}</td></tr>`).join('')}
    </tbody></table>` : `<p class="muted" style="font-size:13px">Nothing scheduled. ${cal?.cadence !== 'scheduled' ? 'Switch cadence to “scheduled” in Settings to drip-publish.' : 'Approved drafts will fill the next slots:'}</p>`}
    ${cal?.nextSlots?.length && !upcoming.length ? `<p class="muted" style="font-size:12px">Next slots: ${cal.nextSlots.slice(0, 4).map((s) => esc(s.replace('T', ' ').slice(0, 16))).join(' · ')}</p>` : ''}</div>`;

  const rankCard = `<div class="card">
    <div class="section-head"><h3>📉 Rank tracker</h3><span>${rank ? `${rank.snapshotDays} day(s) · ${rank.trackedUrls} URLs` : '—'}</span></div>
    <div class="inline" style="margin:4px 0 8px">
      <span class="badge ${rank?.decliners ? 'failed' : ''}">${rank?.decliners ?? 0} ↓ slipping</span>
      <span class="badge ${rank?.improvers ? 'published' : ''}">${rank?.improvers ?? 0} ↑ rising</span>
      <span class="muted" style="font-size:12px">${rank?.hasToday ? 'snapshotted today' : 'no snapshot today'}</span></div>
    <div class="inline"><button class="btn sm" onclick="apSnapshot()">📸 Snapshot now</button>
      <button class="btn sm ghost" onclick="apTrends()">View movers</button></div>
    <div id="apTrendsOut" style="margin-top:8px"></div></div>`;

  const idxCard = `<div class="card">
    <div class="section-head"><h3>🔎 Index coverage</h3>${on(idx?.enabled)}</div>
    <p style="font-size:13px">Indexing API: ${yn(idx?.configured)} ${idx?.configured ? 'service account set' : 'not configured'}</p>
    <div class="inline" style="margin:4px 0 8px">
      <span class="badge">${idx?.submitted ?? 0} submitted</span>
      <span class="badge published">${idx?.indexed ?? 0} indexed</span></div>
    <div class="inline"><button class="btn sm" onclick="apIndexMonitor()">Check recent</button>
      <button class="btn sm ghost" onclick="apIndexList()">View status</button></div>
    <div id="apIndexOut" style="margin-top:8px"></div></div>`;

  const distCard = `<div class="card">
    <div class="section-head"><h3>📣 Linking &amp; distribution</h3></div>
    <p style="font-size:13px">Share webhook: ${yn(dist?.share)} · Notifications: ${yn(dist?.notify)}</p>
    <div class="inline"><button class="btn sm" onclick="apTestNotify()">Send test alert</button>
      <button class="btn sm" onclick="apOrphans()">🔗 Scan orphans</button></div>
    <div id="apOrphansOut" style="margin-top:8px"></div></div>`;

  $('#view').innerHTML = `
    <div class="card" style="background:linear-gradient(120deg,var(--accent),var(--accent-2));color:#fff;border:0">
      <h2 style="margin:0">🤖 24/7 Autopilot engine</h2>
      <p style="margin:6px 0 0;opacity:.92">Six steps run every tick: replenish ideas → generate → publish/schedule → GSC fixes → rank-track &amp; auto-refresh → index-monitor. Each step is owner-toggleable in Settings.</p>
      <div class="inline" style="margin-top:10px"><button class="btn" style="background:#fff;color:var(--accent)" onclick="runNow()">⚡ Run a tick now</button></div>
    </div>
    <div class="grid cols-2" style="margin-top:16px;gap:16px">${queueCard}${calCard}${rankCard}${idxCard}${distCard}</div>`;
};
window.apReplenish = async () => {
  const out = $('#apReplenishOut'); out.innerHTML = '<span class="spinner"></span> Researching fresh keywords…';
  try { const r = await api.post('/autopilot/replenish', { force: true }); out.textContent = r.added ? `Added ${r.added} fresh ideas (source: ${r.source}); queue now ${r.queue}.` : `No new ideas found (queue ${r.queue}).`; toast('Replenish done', 'success'); }
  catch (e) { out.textContent = ''; toast(e.message, 'error'); }
};
window.apSnapshot = async () => {
  toast('Snapshotting positions…');
  try { const r = await api.post('/ranktrack/snapshot', {}); toast(r.skipped ? r.skipped : `Snapshot saved: ${r.rows} pages`, 'success'); views.autopilot(); }
  catch (e) { toast(e.message, 'error'); }
};
window.apTrends = async () => {
  const out = $('#apTrendsOut'); out.innerHTML = '<span class="spinner"></span>';
  try {
    const t = await api.get('/ranktrack/trends');
    if (!t.length) { out.innerHTML = '<p class="muted" style="font-size:12px">No trend data yet — take snapshots over a few days.</p>'; return; }
    out.innerHTML = `<table><thead><tr><th>Page</th><th>Was→Now</th><th>Δ</th></tr></thead><tbody>
      ${t.slice(0, 10).map((r) => `<tr><td style="font-size:12px">${esc((r.url || '').replace(/^https?:\/\/[^/]+/, ''))}</td>
        <td class="muted" style="font-size:12px">${r.positionFrom}→${r.positionTo}</td>
        <td>${r.delta > 0 ? `<span class="badge failed">+${r.delta}</span>` : r.delta < 0 ? `<span class="badge published">${r.delta}</span>` : '0'}</td></tr>`).join('')}
    </tbody></table>`;
  } catch (e) { out.textContent = e.message; }
};
window.apIndexMonitor = async () => {
  toast('Inspecting recent URLs in Search Console…');
  try { const r = await api.post('/indexmon/monitor', { limit: 5 }); toast(`Checked ${r.checked} URL(s)`, 'success'); apIndexList(); }
  catch (e) { toast(e.message, 'error'); }
};
window.apIndexList = async () => {
  const out = $('#apIndexOut'); out.innerHTML = '<span class="spinner"></span>';
  try {
    const rows = await api.get('/indexmon/list');
    if (!rows.length) { out.innerHTML = '<p class="muted" style="font-size:12px">No index data yet. Publish a post (with Indexing on) or click “Check recent”.</p>'; return; }
    out.innerHTML = `<table><thead><tr><th>URL</th><th>Verdict</th><th>Coverage</th></tr></thead><tbody>
      ${rows.slice(0, 12).map((r) => `<tr><td style="font-size:12px">${esc((r.url || '').replace(/^https?:\/\/[^/]+/, ''))}</td>
        <td>${r.verdict === 'PASS' ? '<span class="badge published">PASS</span>' : r.verdict ? `<span class="badge failed">${esc(r.verdict)}</span>` : '—'}</td>
        <td class="muted" style="font-size:12px">${esc(r.coverage || '—')}</td></tr>`).join('')}
    </tbody></table>`;
  } catch (e) { out.textContent = e.message; }
};
window.apTestNotify = async () => {
  try { const r = await api.post('/distribute/test', {}); toast(r.skipped ? 'Set a notifications webhook in Settings first' : 'Test alert sent ✅', r.skipped ? 'error' : 'success'); }
  catch (e) { toast(e.message, 'error'); }
};
window.apOrphans = async () => {
  const out = $('#apOrphansOut'); out.innerHTML = '<span class="spinner"></span> Scanning your published posts…';
  try {
    const r = await api.get('/interlink/orphans');
    out.innerHTML = `<p style="font-size:13px"><b>${r.orphanCount}</b> orphan page(s) of ${r.total} scanned ${r.orphanCount ? '— these have no incoming internal links:' : '✅ every page has an incoming link.'}</p>
      ${r.orphanCount ? `<ul style="font-size:12px;margin:4px 0 0;padding-left:18px">${r.orphans.slice(0, 10).map((o) => `<li>${esc(o.title || o.url)}</li>`).join('')}</ul>` : ''}`;
  } catch (e) { out.innerHTML = `<span class="badge failed">${esc(e.message)}</span>`; }
};

// ---- Pages ----------------------------------------------------------------
views.pages = async () => {
  const [list, theme] = await Promise.all([api.get('/pages'), api.get('/theme').catch(() => null)]);
  $('#view').innerHTML = `
    <div class="card">
      <div class="section-head"><h2>🎨 Theme intelligence</h2><button class="btn sm" onclick="analyzeTheme()">${theme ? '🔄 Re-analyse theme' : '▶ Detect &amp; understand theme'}</button></div>
      <p class="hint">The agent detects your active theme dynamically and understands it (no hard-coding), so generated pages &amp; articles match it.</p>
      <div id="themePanel">${themePanelHtml(theme)}</div>
    </div>
    <div class="grid cols-2" style="margin-top:16px;gap:16px">
      <div class="card" style="margin:0">
        <h3>🎨 Design a new page</h3>
        <div class="grid cols-2">
          <label class="field"><span>Title</span><input id="pgTitle" placeholder="e.g. CCTV Installation Services"/></label>
          <label class="field"><span>Page type</span><select id="pgKind">
            <option value="landing">Landing</option>
            <option value="homepage">Homepage</option>
            <option value="about">About</option>
            <option value="services">Services</option>
            <option value="contact">Contact</option>
            <option value="hub">Hub / Pillar</option>
            <option value="standard">Standard</option></select></label>
        </div>
        <label class="field"><span>Brief (optional)</span><textarea id="pgBrief" placeholder="What the page should cover, sections, CTA…"></textarea></label>
        <div class="inline"><button class="btn" onclick="designPage()">🎨 Design with AI</button>
          <button class="btn secondary" onclick="importPicker()">Import a live page</button></div>
      </div>
      <div class="card" style="margin:0;border:1px dashed var(--accent)">
        <h3>📸 Replicate a design (AI vision)</h3>
        <p class="hint" style="margin:4px 0 8px">Upload a mockup, screenshot, Figma export or competitor screenshot — the AI reads the image and reproduces its layout as native Gutenberg blocks, in your theme's palette &amp; fonts.</p>
        <label class="field"><span>Title</span><input id="repTitle" placeholder="e.g. Pricing page (Stripe-style)"/></label>
        <div class="grid cols-2">
          <label class="field"><span>Page type</span><select id="repKind">
            <option value="landing">Landing</option><option value="homepage">Homepage</option>
            <option value="about">About</option><option value="services">Services</option>
            <option value="contact">Contact</option><option value="hub">Hub</option>
            <option value="standard" selected>Standard</option></select></label>
          <label class="field"><span>Design file</span><input id="repFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif"/></label>
        </div>
        <label class="field"><span>Notes (optional)</span><textarea id="repNotes" placeholder="Anything to emphasise: ‘keep the green hero’, ‘swap the testimonial for stats’…"></textarea></label>
        <div class="inline"><button class="btn" onclick="replicateDesign()">📸 Replicate with AI</button></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head"><h2>Pages (${list.length})</h2></div>
      ${list.length ? `<table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((p) => `<tr><td>${esc(p.title)}${p.error?`<br><span class="badge failed">${esc(p.error.slice(0,50))}</span>`:''}</td>
          <td>${badge(p.kind)}</td><td>${badge(p.status)}</td>
          <td class="row-actions">
            <button class="btn sm" onclick="previewPage(${p.id})" title="See it styled with your theme">👁 Preview</button>
            <button class="btn sm" onclick="designPageVisual(${p.id})" title="Drag &amp; drop section editor">🪄 Design</button>
            <button class="btn sm secondary" onclick="viewPage(${p.id})">Review</button>
            ${p.status!=='published'?`<button class="btn sm success" onclick="publishPage(${p.id})">Publish</button>`:''}
            ${p.wp_url?`<a class="btn sm ghost" href="${esc(p.wp_url)}" target="_blank">↗</a>`:''}
            <button class="btn sm ghost" onclick="delPage(${p.id})">✕</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No pages yet. Design one above.</div>'}
    </div>`;
};
function themePanelHtml(t) {
  if (!t) return '<div class="empty">Theme not analysed yet — click “Detect &amp; understand theme”.</div>';
  const swatch = (c) => `<span title="${esc(c.name)}: ${esc(c.hex)}" style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:12px"><span style="width:16px;height:16px;border-radius:4px;border:1px solid var(--border);background:${esc(c.hex)}"></span>${esc(c.name)}</span>`;
  return `<p class="muted"><b style="color:var(--text)">${esc(t.theme)}</b> v${esc(t.themeVersion || '')} · <span class="badge ${t.themeType === 'block' ? 'published' : 'pending_review'}">${esc(t.themeType)} theme</span> ${t.summary ? '· ' + esc(t.summary) : ''}</p>
    ${(t.palette || []).length ? `<div style="margin:6px 0">${t.palette.map(swatch).join('')}</div>` : ''}
    <p style="font-size:13px">Fonts — heading: <b>${esc(t.fonts?.heading || '—')}</b>, body: <b>${esc(t.fonts?.body || '—')}</b> · container ${esc(t.containerWidth || '—')}${(t.patterns || []).length ? ` · 🧩 <b>${t.patterns.length}</b> theme block patterns (used when designing pages)` : ''}</p>
    <div class="grid cols-2" style="margin-top:6px">
      <div><b style="font-size:12px;color:var(--accent-2)">✅ Editable via API</b>${(t.editableViaApi || []).map((x) => `<div style="font-size:12px">• ${esc(x)}</div>`).join('') || '<div class="muted">—</div>'}</div>
      <div><b style="font-size:12px;color:var(--warn)">⚠ Not via API (needs Customizer / child theme / CSS)</b>${(t.notEditableViaApi || []).map((x) => `<div style="font-size:12px">• ${esc(x)}</div>`).join('') || '<div class="muted">—</div>'}</div>
    </div>
    ${t.designGuidance ? `<p class="hint" style="margin-top:8px"><b>Design guidance applied to generation:</b> ${esc(t.designGuidance)}</p>` : ''}`;
}
window.analyzeTheme = async () => {
  const el = $('#themePanel'); el.innerHTML = '<div class="empty"><span class="spinner"></span> Detecting &amp; understanding your theme (reads the live site + AI)…</div>';
  try { const t = await api.post('/theme/analyze'); el.innerHTML = themePanelHtml(t); toast(`Understood theme: ${t.theme} (${t.themeType})`, 'success'); }
  catch (e) { el.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; }
};
window.designPage = async () => {
  const title = $('#pgTitle').value.trim(); if (!title) return toast('Enter a title','error');
  toast('Designing page with AI…');
  try { await api.post('/pages/design', { title, kind: $('#pgKind').value, brief: $('#pgBrief').value }); toast('Page drafted','success'); views.pages(); }
  catch (e) { toast(e.message,'error'); }
};
window.importPicker = async () => {
  toast('Fetching live pages…');
  try { const wpPages = await api.get('/wp/pages');
    modal('Import a live page', wpPages.length ? wpPages.map((p) => `<div class="inline" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
      <span>${esc(p.title)} <span class="muted">/${esc(p.slug)}</span></span>
      <button class="btn sm" onclick="doImport(${p.id})">Import</button></div>`).join('') : '<div class="empty">No pages found.</div>');
  } catch (e) { toast(e.message,'error'); }
};
window.doImport = async (wpPageId) => { await api.post('/pages/import', { wpPageId }); closeModal(); toast('Imported — now you can redesign it','success'); views.pages(); };
window.viewPage = async (id) => {
  const p = await api.get('/pages/' + id);
  modal(p.title, `
    <label class="field"><span>Title</span><input id="pg_title" value="${esc(p.title||'')}"/></label>
    <label class="field"><span>Redesign instructions (optional)</span><input id="pg_instr" placeholder="e.g. add a pricing table, modernise hero"/></label>
    <div class="inline" style="margin-bottom:14px">
      <button class="btn secondary" onclick="redesignPage(${id})">🪄 AI redesign</button>
    </div>
    <label class="field"><span>Content (Gutenberg blocks)</span><textarea id="pg_content" style="min-height:260px">${esc(p.content||'')}</textarea></label>
    <div class="inline">
      <button class="btn" onclick="savePage(${id})">Save</button>
      <button class="btn success" onclick="closeModal();publishPage(${id})">Publish to WP</button>
      <button class="btn ghost" onclick="closeModal()">Close</button>
    </div>`);
};
window.redesignPage = async (id) => { toast('AI is redesigning…'); try { await api.post(`/pages/${id}/redesign`, { instructions: $('#pg_instr').value }); toast('Redesigned — reopen to view','success'); closeModal(); views.pages(); } catch (e) { toast(e.message,'error'); } };
window.savePage = async (id) => { await api.put('/pages/' + id, { title: $('#pg_title').value, content: $('#pg_content').value }); toast('Saved','success'); closeModal(); views.pages(); };
window.publishPage = async (id) => { toast('Publishing page…'); try { await api.post(`/pages/${id}/publish`); toast('Published!','success'); views.pages(); } catch (e) { toast(e.message,'error'); } };
window.delPage = async (id) => { if (confirm('Delete page?')) { await api.del('/pages/' + id); views.pages(); } };

// ---- Page Preview (theme-styled) ------------------------------------------
window.previewPage = async (id) => {
  const [p, theme] = await Promise.all([api.get('/pages/' + id), getTheme()]);
  modal(`👁 Preview — ${esc(p.title || '')}`, `
    ${themePreviewBlock(theme, p.title || '', p.content)}
    <p class="preview-note">Preview uses <b>${esc(themeVars(theme).name)}</b>’s palette &amp; fonts. The live render may add the theme header/footer; click Publish to see it on the site.</p>
    <div class="inline" style="margin-top:12px"><button class="btn" onclick="closeModal();designPageVisual(${id})">🪄 Open visual designer</button><button class="btn success" onclick="closeModal();publishPage(${id})">Publish to WP</button><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  const m = $('#modal .modal'); if (m) m.classList.add('preview-modal');
};

// ---- Drag-and-drop visual section designer --------------------------------
// Parses the page's content into top-level Gutenberg blocks ("sections"),
// renders each as a draggable card, lets the user reorder/edit/duplicate/
// delete/insert sections, and recomposes the markup on save.
function splitSections(markup) {
  const src = (markup || '').trim();
  const sections = [];
  let i = 0;
  while (i < src.length) {
    const m = src.slice(i).match(/<!--\s*wp:([a-z0-9-/]+)([^>]*)-->/);
    if (!m) { const tail = src.slice(i).trim(); if (tail) sections.push({ kind: 'raw', html: tail }); break; }
    const start = i + m.index;
    const name = m[1];
    const close = `<!-- /wp:${name} -->`;
    const closeIdx = src.indexOf(close, start);
    if (closeIdx < 0) { sections.push({ kind: name, html: src.slice(start) }); break; }
    const end = closeIdx + close.length;
    sections.push({ kind: name, html: src.slice(start, end) });
    i = end;
  }
  return sections;
}
function summarizeSection(html) {
  const h = (html.match(/<(h[1-6])[^>]*>([^<]+)<\/h[1-6]>/i) || [])[2]
    || (html.match(/<p[^>]*>([^<]+)<\/p>/i) || [])[1]
    || '';
  return h.length > 80 ? h.slice(0, 80) + '…' : h;
}
const SECTION_TEMPLATES = {
  hero: `<!-- wp:cover {"overlayColor":"primary","minHeight":420} -->
<div class="wp-block-cover" style="min-height:420px"><div class="wp-block-cover__inner-container">
<!-- wp:heading {"textAlign":"center","level":1} --><h1 class="has-text-align-center">New section heading</h1><!-- /wp:heading -->
<!-- wp:paragraph {"align":"center"} --><p class="has-text-align-center">A short, compelling subheading that supports the headline.</p><!-- /wp:paragraph -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Get started</a></div><!-- /wp:button --></div><!-- /wp:buttons -->
</div></div>
<!-- /wp:cover -->`,
  columns3: `<!-- wp:columns -->
<div class="wp-block-columns">
<!-- wp:column --><div class="wp-block-column"><!-- wp:heading {"level":3} --><h3>Feature one</h3><!-- /wp:heading --><!-- wp:paragraph --><p>One clear sentence about this feature and why it matters.</p><!-- /wp:paragraph --></div><!-- /wp:column -->
<!-- wp:column --><div class="wp-block-column"><!-- wp:heading {"level":3} --><h3>Feature two</h3><!-- /wp:heading --><!-- wp:paragraph --><p>One clear sentence about this feature and why it matters.</p><!-- /wp:paragraph --></div><!-- /wp:column -->
<!-- wp:column --><div class="wp-block-column"><!-- wp:heading {"level":3} --><h3>Feature three</h3><!-- /wp:heading --><!-- wp:paragraph --><p>One clear sentence about this feature and why it matters.</p><!-- /wp:paragraph --></div><!-- /wp:column -->
</div>
<!-- /wp:columns -->`,
  cta: `<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group" style="text-align:center;padding:48px 24px">
<!-- wp:heading {"textAlign":"center"} --><h2 class="has-text-align-center">Ready to get started?</h2><!-- /wp:heading -->
<!-- wp:paragraph {"align":"center"} --><p class="has-text-align-center">A single, focused next-step for the visitor.</p><!-- /wp:paragraph -->
<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Get started</a></div><!-- /wp:button --></div><!-- /wp:buttons -->
</div>
<!-- /wp:group -->`,
  faq: `<!-- wp:heading --><h2>Frequently asked questions</h2><!-- /wp:heading -->
<!-- wp:heading {"level":3} --><h3>What does this include?</h3><!-- /wp:heading -->
<!-- wp:paragraph --><p>Answer the question clearly and concisely in 1–2 sentences.</p><!-- /wp:paragraph -->
<!-- wp:heading {"level":3} --><h3>How do I get started?</h3><!-- /wp:heading -->
<!-- wp:paragraph --><p>Answer the question clearly and concisely in 1–2 sentences.</p><!-- /wp:paragraph -->`,
  paragraph: `<!-- wp:heading --><h2>Section heading</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Write a section of body copy here. Replace this with real content.</p><!-- /wp:paragraph -->`,
  separator: `<!-- wp:separator --><hr class="wp-block-separator has-alpha-channel-opacity"/><!-- /wp:separator -->`,
};
window.designerState = { id: null, sections: [], dragIdx: null };
const designerState = window.designerState;
window.designPageVisual = async (id) => {
  const p = await api.get('/pages/' + id);
  Object.assign(window.designerState, { id, sections: splitSections(p.content || ''), dragIdx: null, title: p.title });
  renderDesigner();
};
function renderDesigner() {
  const s = designerState;
  const palette = Object.entries({
    hero: '🖼 Hero', columns3: '🧱 3 columns', cta: '🎯 CTA band', faq: '❓ FAQ', paragraph: '📝 Heading + paragraph', separator: '— Separator',
  }).map(([k, label]) => `<button class="btn sm" onclick="dInsert('${k}')">${label}</button>`).join('');
  modal(`🪄 Visual designer — ${esc(s.title || '')}`, `
    <style scoped>
      .dz { display:flex;flex-direction:column;gap:10px;padding:8px;background:var(--bg-elev);border-radius:8px;min-height:200px }
      .ds { background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 12px;cursor:grab;display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:start }
      .ds.dragging { opacity:.4 }
      .ds.drop-target { border-color:var(--accent);box-shadow:0 0 0 2px var(--accent) inset }
      .ds .h { font-size:13px;font-weight:600 }
      .ds .x { font-size:11px;color:var(--muted);font-family:ui-monospace,monospace }
      .ds textarea { width:100%;min-height:140px;font-family:ui-monospace,monospace;font-size:12px }
    </style>
    <p class="hint">Drag sections by the ⋮⋮ handle to reorder. Use the section toolbar below to add more.</p>
    <div class="inline" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">${palette}</div>
    <div id="dz" class="dz">${s.sections.map(renderCard).join('') || '<div class="empty">No sections yet — insert one from the toolbar above.</div>'}</div>
    <div class="inline" style="margin-top:14px">
      <button class="btn" onclick="dSave()">💾 Save</button>
      <button class="btn secondary" onclick="dSave().then(()=>{closeModal();previewPage(${s.id})})">💾 Save &amp; preview</button>
      <button class="btn success" onclick="dSave().then(()=>{closeModal();publishPage(${s.id})})">💾 Save &amp; publish</button>
      <button class="btn ghost" onclick="closeModal()">Close</button>
    </div>`);
  bindDnd();
}
function renderCard(sec, i) {
  const txt = esc(summarizeSection(sec.html) || '(no preview)');
  return `<div class="ds" draggable="true" data-i="${i}" ondragstart="dStart(event,${i})" ondragover="dOver(event,${i})" ondrop="dDrop(event,${i})" ondragend="dEnd(event)">
    <div title="Drag to reorder" style="cursor:grab;color:var(--muted);user-select:none">⋮⋮</div>
    <div>
      <div class="h">${esc(sec.kind)} <span class="x">${i + 1}</span></div>
      <div class="muted" style="font-size:12px;margin-top:2px">${txt}</div>
      <details style="margin-top:6px"><summary style="font-size:12px;cursor:pointer">Edit raw block markup</summary>
        <textarea oninput="dEdit(${i}, this.value)">${esc(sec.html)}</textarea></details>
    </div>
    <div class="row-actions" style="display:flex;flex-direction:column;gap:4px">
      <button class="btn sm ghost" onclick="dMove(${i},-1)" title="Move up">↑</button>
      <button class="btn sm ghost" onclick="dMove(${i},1)" title="Move down">↓</button>
      <button class="btn sm ghost" onclick="dDup(${i})" title="Duplicate">⎘</button>
      <button class="btn sm ghost" onclick="dDel(${i})" title="Delete">✕</button>
    </div>
  </div>`;
}
function bindDnd() { /* native HTML5 DnD wired via inline handlers */ }
window.dStart = (e, i) => { designerState.dragIdx = i; e.target.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; };
window.dOver = (e, i) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const el = e.currentTarget; document.querySelectorAll('.ds.drop-target').forEach((n) => n.classList.remove('drop-target')); el.classList.add('drop-target'); };
window.dDrop = (e, target) => { e.preventDefault(); const from = designerState.dragIdx; if (from == null || from === target) return; const arr = designerState.sections; const [m] = arr.splice(from, 1); arr.splice(target, 0, m); designerState.dragIdx = null; renderDesigner(); };
window.dEnd = () => { document.querySelectorAll('.ds.drop-target,.ds.dragging').forEach((n) => n.classList.remove('drop-target', 'dragging')); designerState.dragIdx = null; };
window.dMove = (i, dir) => { const arr = designerState.sections; const j = i + dir; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; renderDesigner(); };
window.dDup = (i) => { designerState.sections.splice(i + 1, 0, { ...designerState.sections[i] }); renderDesigner(); };
window.dDel = (i) => { designerState.sections.splice(i, 1); renderDesigner(); };
window.dEdit = (i, html) => { designerState.sections[i].html = html; };
window.dInsert = (key) => { designerState.sections.push({ kind: key, html: SECTION_TEMPLATES[key] }); renderDesigner(); };
window.dSave = async () => {
  const content = designerState.sections.map((s) => s.html).join('\n\n');
  await api.put('/pages/' + designerState.id, { content });
  toast('Layout saved', 'success');
};

// ---- Replicate a design (image upload → AI replica) -----------------------
window.replicateDesign = async () => {
  const title = $('#repTitle').value.trim();
  const kind = $('#repKind').value;
  const notes = $('#repNotes').value.trim();
  const f = $('#repFile').files?.[0];
  if (!title) return toast('Enter a title for the page', 'error');
  if (!f) return toast('Choose a design image (PNG/JPG/WebP)', 'error');
  if (f.size > 8 * 1024 * 1024) return toast('Image too large (>8 MB)', 'error');
  toast('Reading design…');
  const b64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
  toast('AI is replicating your design — this may take 20–60s…');
  try {
    const p = await api.post('/pages/replicate', { imageBase64: b64, mimeType: f.type || 'image/png', title, kind, notes });
    toast(`Replicated as "${p.title}" — open the visual designer to tweak`, 'success');
    views.pages();
    setTimeout(() => designPageVisual(p.id), 400);
  } catch (e) { toast(e.message, 'error'); }
};

// ---- Content Stats --------------------------------------------------------
let perfDays = 28;
views.stats = async () => {
  $('#view').innerHTML = '<div class="empty"><span class="spinner"></span> Loading stats…</div>';
  const s = await api.get('/stats');
  const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

  // Production matrix: rows × periods.
  const matrixRow = (label, p) => `<tr><td>${label}</td><td>${p.today}</td><td>${p.d7}</td><td>${p.d30}</td><td>${p.d90}</td><td><b>${p.all}</b></td></tr>`;
  const statusBadges = (o) => Object.entries(o || {}).map(([k, v]) => `${badge(k)} ${v}`).join(' &nbsp; ') || '<span class="muted">none</span>';

  // Tiny inline sparkline of published-per-day (last 30d).
  const spark = (series) => {
    const max = Math.max(1, ...series.map((d) => d.count));
    return `<div class="spark">${series.map((d) => `<span class="spark-bar" style="height:${Math.round((d.count / max) * 100) || 3}%" title="${d.date}: ${d.count}"></span>`).join('')}</div>`;
  };

  $('#view').innerHTML = `
    <div class="grid cols-4">
      <div class="card"><h3>Articles — total</h3><div class="stat">${s.articles.total}</div><div class="stat-sub">${statusBadges(s.articles.byStatus)}</div></div>
      <div class="card"><h3>Pages — total</h3><div class="stat">${s.pages.total}</div><div class="stat-sub">${statusBadges(s.pages.byStatus)}</div></div>
      <div class="card"><h3>Published last 30d</h3><div class="stat">${s.articles.published.d30 + s.pages.published.d30}</div><div class="stat-sub">${s.articles.published.d30} articles · ${s.pages.published.d30} pages</div></div>
      <div class="card"><h3>Keywords / Clusters</h3><div class="stat">${s.keywords} / ${s.clusters}</div><div class="stat-sub">research pipeline</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-head"><h2>Production over time</h2></div>
      <table><thead><tr><th>Metric</th><th>Today</th><th>7 days</th><th>30 days</th><th>90 days</th><th>All time</th></tr></thead><tbody>
        ${matrixRow('Articles published', s.articles.published)}
        ${matrixRow('Articles created', s.articles.created)}
        ${matrixRow('Pages published', s.pages.published)}
        ${matrixRow('Pages created', s.pages.created)}
      </tbody></table>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Articles published / day (30d)</h3>${spark(s.articles.series)}</div>
      <div class="card"><h3>Pages published / day (30d)</h3>${spark(s.pages.series)}</div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-head"><h2>Published content performance</h2>
        <div class="tabs" style="margin:0">${[7, 28, 90].map((n) => `<div class="tab ${perfDays === n ? 'active' : ''}" onclick="setPerfDays(${n})">${n}d</div>`).join('')}</div></div>
      <div id="perfBody"><div class="empty"><span class="spinner"></span> Loading performance…</div></div>
    </div>`;
  loadPerformance();
};
window.setPerfDays = (n) => { perfDays = n; views.stats(); };
async function loadPerformance() {
  const el = $('#perfBody');
  if (!el) return;
  let p;
  try { p = await api.get('/stats/performance?days=' + perfDays); }
  catch (e) { el.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; return; }
  const pct = (n) => (n * 100).toFixed(1) + '%';
  const g = (x) => (x ? `<td>${x.clicks}</td><td>${x.impressions}</td><td>${pct(x.ctr)}</td><td>${x.position}</td>` : '<td>–</td><td>–</td><td>–</td><td>–</td>');
  const all = [
    ...p.articles.map((a) => ({ ...a, type: 'Article' })),
    ...p.pages.map((a) => ({ ...a, type: 'Page' })),
  ].sort((a, b) => (b.gsc?.clicks || 0) - (a.gsc?.clicks || 0));

  if (!all.length) { el.innerHTML = '<div class="empty">Nothing published yet. Approve an article or publish a page to see it here.</div>'; return; }
  const note = p.gscConnected
    ? (p.gscError ? `<p class="hint">Search Console error: ${esc(p.gscError)}</p>` : `<p class="hint">Traffic shown for the last ${p.window.days} days from Search Console.</p>`)
    : '<p class="hint">Connect Search Console to see clicks/impressions per page.</p>';
  el.innerHTML = note + `<table><thead><tr><th>Title</th><th>Type</th><th>Published</th><th>Clicks</th><th>Impr</th><th>CTR</th><th>Pos</th><th>Index</th></tr></thead><tbody>
    ${all.map((a) => `<tr>
      <td>${a.wp_url ? `<a href="${esc(a.wp_url)}" target="_blank">${esc(a.title || '(untitled)')}</a>` : esc(a.title || '(untitled)')}</td>
      <td><span class="badge ${a.type === 'Article' ? 'approved' : 'planned'}">${a.type}</span></td>
      <td class="muted" style="font-size:12px">${esc((a.published_at || '').slice(0, 10))}</td>
      ${g(a.gsc)}
      <td>${a.wp_url ? `<button class="btn sm ghost" onclick="checkIndex('${encodeURIComponent(a.wp_url)}', this)">check</button>` : '–'}</td></tr>`).join('')}
  </tbody></table>`;
}
window.checkIndex = async (u, btn) => {
  if (btn) { btn.textContent = '…'; btn.disabled = true; }
  try {
    const r = await api.get('/gsc/inspect?url=' + u);
    const ok = r.verdict === 'PASS';
    if (btn) { btn.outerHTML = `<span class="badge ${ok ? 'published' : 'failed'}" title="${esc(r.coverageState || '')}">${esc(r.coverageState || r.verdict || 'unknown')}</span>`; }
  } catch (e) { if (btn) { btn.outerHTML = `<span class="badge failed" title="${esc(e.message)}">error</span>`; } }
};

// ---- Ahrefs — keywords, competitors, backlinks, domain intelligence -------
const AHREFS_TABS = [
  { id: 'overview', label: '🌐 Domain overview', input: 'domain', use: 'Domain Rating, organic traffic, ranking keywords and backlink/refdomain counts for any site — yours or a competitor.' },
  { id: 'keywords', label: '🔑 Keyword research', input: 'keyword', use: 'Expand a seed term into related keyword ideas with search volume and difficulty.' },
  { id: 'competitors', label: '🥊 Competitor SERP', input: 'keyword', use: 'The top-ranking pages for a keyword — URL, position, Domain Rating and traffic — to see who you’re up against.' },
  { id: 'backlinks', label: '🔗 Backlinks', input: 'domain', use: 'Backlinks pointing at a site (newest first) — for audits and link-building intelligence.' },
  { id: 'refdomains', label: '🌍 Referring domains', input: 'domain', use: 'The domains linking to a site, ranked by strength — your outreach prospect list.' },
  { id: 'organic', label: '📈 Organic keywords', input: 'domain', use: 'Keywords a site already ranks for — surface competitor terms you could target too.' },
  { id: 'toppages', label: '⭐ Top pages', input: 'domain', use: 'A site’s best-performing pages by organic traffic — what content earns them clicks.' },
];
const ahState = { tab: 'overview', target: '', keyword: '' };
const fmtNum = (n) => (n == null ? '–' : Number(n).toLocaleString());
const ahDr = (n) => (n == null ? '–' : `<span class="badge ${n >= 50 ? 'published' : n >= 20 ? 'pending_review' : ''}">${n}</span>`);

function ahrefsUseCases() {
  return `<div class="callout tip"><span class="ico">🔗</span><div>
    <b>What Ahrefs powers here.</b> Beyond keywords, your Ahrefs API drives competitor and backlink intelligence:
    <ul style="margin:6px 0 0;padding-left:18px;line-height:1.7">
      <li><b>Keyword research</b> — seed → related keywords with volume &amp; difficulty (also feeds the 24/7 idea queue).</li>
      <li><b>Competitor SERP analysis</b> — who ranks for a keyword (used automatically in Post Intelligence gap analysis).</li>
      <li><b>Backlinks &amp; referring domains</b> — audit your link profile or a competitor’s; build an outreach list.</li>
      <li><b>Domain metrics</b> — Domain Rating, organic traffic &amp; keyword counts for any site.</li>
      <li><b>Organic keywords &amp; top pages</b> — see exactly what content &amp; terms win traffic for any domain.</li>
    </ul></div></div>`;
}
views.ahrefs = async () => {
  let st; try { st = await api.get('/ahrefs/status'); } catch { st = { configured: false }; }
  if (!st.configured) {
    $('#view').innerHTML = `${ahrefsUseCases()}
      <div class="callout warn"><span class="ico">⚠️</span><div><b>Ahrefs isn’t connected.</b> Add your Ahrefs API token in
        <a href="#" onclick="navigate('settings');return false">Settings → Connections</a> to unlock everything above.
        <br><span class="muted" style="font-size:12px">Note: Ahrefs API access is a paid add-on billed in “API units”, separate from a normal Ahrefs subscription.</span></div></div>`;
    return;
  }
  if (!ahState.target) ahState.target = st.defaultTarget || '';
  const lu = st.limits?.limits_and_usage;
  const usage = lu ? `${fmtNum(lu.units_usage_workspace)} / ${fmtNum(lu.units_limit_workspace)} API units used` : null;
  ahState.usage = usage;
  renderAhrefs(usage);
};
function renderAhrefs(usage) {
  const tab = AHREFS_TABS.find((t) => t.id === ahState.tab) || AHREFS_TABS[0];
  const inputBar = tab.input === 'keyword'
    ? `<input id="ahKeyword" placeholder="Enter a keyword…" value="${esc(ahState.keyword)}" style="min-width:260px" onkeydown="if(event.key==='Enter')ahRun()"/>`
    : `<input id="ahTarget" placeholder="domain or URL (e.g. competitor.com)" value="${esc(ahState.target)}" style="min-width:260px" onkeydown="if(event.key==='Enter')ahRun()"/>
       <span class="muted" style="font-size:12px">your site or any competitor</span>`;
  $('#view').innerHTML = `
    ${ahrefsUseCases()}
    <div class="card">
      <div class="subtabs">${AHREFS_TABS.map((t) => `<button class="subtab ${t.id === ahState.tab ? 'active' : ''}" onclick="ahTab('${t.id}')">${t.label}</button>`).join('')}</div>
      <p class="hint">${esc(tab.use)}</p>
      <div class="toolbar">${inputBar}<button class="btn" onclick="ahRun()">Run</button>
        ${usage ? `<div class="spacer"></div><span class="muted" style="font-size:12px" data-tip="Your Ahrefs API consumption this period">⛽ ${esc(usage)}</span>` : ''}</div>
      <div id="ahrefsOut"><div class="empty">Enter ${tab.input === 'keyword' ? 'a keyword' : 'a domain'} and click Run.</div></div>
    </div>`;
};
window.ahTab = (id) => {
  ahState.tab = id; renderAhrefs(ahState.usage);
  const tab = AHREFS_TABS.find((t) => t.id === id);
  // Auto-run only when we already have the needed input (domain tabs default to your site).
  if (tab.input === 'keyword' ? ahState.keyword : ahState.target) ahRun();
};
window.ahRun = async () => {
  const tab = AHREFS_TABS.find((t) => t.id === ahState.tab) || AHREFS_TABS[0];
  if (tab.input === 'keyword') { ahState.keyword = ($('#ahKeyword')?.value || '').trim(); if (!ahState.keyword) return toast('Enter a keyword', 'error'); }
  else { ahState.target = ($('#ahTarget')?.value || '').trim(); if (!ahState.target) return toast('Enter a domain or URL', 'error'); }
  const out = $('#ahrefsOut');
  out.innerHTML = '<div class="loading-state"><span class="spinner spinner-lg"></span>Querying Ahrefs…</div>';
  try {
    if (tab.id === 'overview') return ahRenderOverview(out, await api.get('/ahrefs/domain?target=' + encodeURIComponent(ahState.target)));
    if (tab.id === 'keywords') return ahRenderKeywords(out, await api.get('/ahrefs/keywords?seed=' + encodeURIComponent(ahState.keyword)));
    if (tab.id === 'competitors') return ahRenderCompetitors(out, await api.get('/ahrefs/competitors?keyword=' + encodeURIComponent(ahState.keyword)));
    if (tab.id === 'backlinks') return ahRenderBacklinks(out, await api.get('/ahrefs/backlinks?target=' + encodeURIComponent(ahState.target)));
    if (tab.id === 'refdomains') return ahRenderRefdomains(out, await api.get('/ahrefs/refdomains?target=' + encodeURIComponent(ahState.target)));
    if (tab.id === 'organic') return ahRenderOrganic(out, await api.get('/ahrefs/organic?target=' + encodeURIComponent(ahState.target)));
    if (tab.id === 'toppages') return ahRenderTopPages(out, await api.get('/ahrefs/toppages?target=' + encodeURIComponent(ahState.target)));
  } catch (e) { out.innerHTML = `<div class="callout warn"><span class="ico">⚠️</span><div>${esc(e.message)}<br><span class="muted" style="font-size:12px">Some endpoints depend on your Ahrefs plan/API units.</span></div></div>`; }
};
const ahEmpty = (what) => `<div class="empty">No ${what} returned. This can mean the site has none, or your Ahrefs plan doesn’t expose this endpoint.</div>`;
const ahLink = (u) => `<a href="${esc(u)}" target="_blank" style="font-size:12px">${esc((u || '').replace(/^https?:\/\//, '').slice(0, 60))}</a>`;
function ahRenderOverview(out, d) {
  const card = (label, val) => `<div class="card"><h3>${label}</h3><div class="stat">${val}</div></div>`;
  out.innerHTML = `<div class="grid cols-4" style="margin-bottom:4px">
    ${card('Domain Rating', d.domainRating ?? '–')}
    ${card('Organic traffic', fmtNum(d.orgTraffic))}
    ${card('Organic keywords', fmtNum(d.orgKeywords))}
    ${card('Referring domains', fmtNum(d.refDomains))}
  </div><p class="muted" style="font-size:13px">Backlinks: <b>${fmtNum(d.backlinks)}</b>${d.ahrefsRank ? ` · Ahrefs Rank: ${fmtNum(d.ahrefsRank)}` : ''} · target <b>${esc(d.target)}</b></p>`;
}
function ahRenderKeywords(out, rows) {
  if (!rows.length) return out.innerHTML = ahEmpty('keywords');
  out.innerHTML = `<table><thead><tr><th>Keyword</th><th>Volume</th><th>KD</th><th>CPC</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.keyword)}</td><td>${fmtNum(r.volume)}</td><td>${r.difficulty ?? '–'}</td><td>${r.cpc != null ? '$' + r.cpc : '–'}</td>
      <td class="row-actions"><button class="btn sm" onclick="goWorkflowCreate([${JSON.stringify(r.keyword)}])">→ create</button></td></tr>`).join('')}</tbody></table>`;
}
function ahRenderCompetitors(out, rows) {
  if (!rows.length) return out.innerHTML = ahEmpty('SERP results');
  out.innerHTML = `<table><thead><tr><th>#</th><th>Page</th><th>DR</th><th>Backlinks</th><th>Traffic</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${r.position ?? '–'}</td><td>${ahLink(r.url)}${r.title ? `<br><span class="muted" style="font-size:11px">${esc(r.title.slice(0, 70))}</span>` : ''}</td>
      <td>${ahDr(r.dr)}</td><td>${fmtNum(r.backlinks)}</td><td>${fmtNum(r.traffic)}</td></tr>`).join('')}</tbody></table>`;
}
function ahRenderBacklinks(out, rows) {
  if (!rows.length) return out.innerHTML = ahEmpty('backlinks');
  out.innerHTML = `<table><thead><tr><th>From</th><th>Anchor</th><th>DR</th><th>Type</th><th>First seen</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${ahLink(r.fromUrl)}</td><td style="font-size:12px">${esc((r.anchor || '').slice(0, 40))}</td><td>${ahDr(r.dr)}</td>
      <td>${r.nofollow ? '<span class="badge">nofollow</span>' : '<span class="badge approved">dofollow</span>'}</td>
      <td class="muted" style="font-size:12px">${esc((r.firstSeen || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table>`;
}
function ahRenderRefdomains(out, rows) {
  if (!rows.length) return out.innerHTML = ahEmpty('referring domains');
  out.innerHTML = `<table><thead><tr><th>Domain</th><th>DR</th><th>Linked pages</th><th>Dofollow</th><th>First seen</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${ahLink('http://' + r.domain)}</td><td>${ahDr(r.dr)}</td><td>${fmtNum(r.linkedPages)}</td><td>${fmtNum(r.dofollow)}</td>
      <td class="muted" style="font-size:12px">${esc((r.firstSeen || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table>`;
}
function ahRenderOrganic(out, rows) {
  if (!rows.length) return out.innerHTML = ahEmpty('organic keywords');
  out.innerHTML = `<p class="hint">Keywords this domain ranks for — great for finding competitor terms to target.</p>
    <table><thead><tr><th>Keyword</th><th>Pos</th><th>Volume</th><th>Traffic</th><th>URL</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(r.keyword)}</td><td>${r.position ?? '–'}</td><td>${fmtNum(r.volume)}</td><td>${fmtNum(r.traffic)}</td><td>${r.url ? ahLink(r.url) : '–'}</td>
      <td class="row-actions"><button class="btn sm" onclick="goWorkflowCreate([${JSON.stringify(r.keyword)}])">→ target</button></td></tr>`).join('')}</tbody></table>`;
}
function ahRenderTopPages(out, rows) {
  if (!rows.length) return out.innerHTML = ahEmpty('top pages');
  out.innerHTML = `<table><thead><tr><th>Page</th><th>Traffic</th><th>Keywords</th><th>Top keyword</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${ahLink(r.url)}</td><td>${fmtNum(r.traffic)}</td><td>${fmtNum(r.keywords)}</td><td>${esc(r.topKeyword || '–')}${r.topKeywordVolume ? ` <span class="muted">(${fmtNum(r.topKeywordVolume)})</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

// ---- Search Console -------------------------------------------------------
let gscDays = 28;
views.searchconsole = async () => {
  const st = await api.get('/gsc/status');
  if (!st.configured) {
    $('#view').innerHTML = `<div class="card">
      <h3>Connect Google Search Console</h3>
      <p class="muted">See how your site is performing in Google — clicks, impressions, positions, top queries — and get AI recommendations on what to fix.</p>
      <ol class="muted" style="line-height:1.9;font-size:13px">
        <li>In <a href="https://console.cloud.google.com" target="_blank">Google Cloud Console</a>: create a project → enable <b>Google Search Console API</b>.</li>
        <li>Credentials → <b>OAuth client ID</b> → type <b>Web application</b>.</li>
        <li>Add this <b>Authorised redirect URI</b>: <code>${esc(st.redirectUri)}</code></li>
        <li>Paste the Client ID + Secret in <a href="#" onclick="navigate('settings');return false">Settings</a>, then click Connect below.</li>
      </ol>
      <button class="btn" onclick="connectGsc()" ${st.hasClient ? '' : 'disabled'}>${st.hasClient ? '🔗 Connect Search Console' : 'Add Client ID in Settings first'}</button>
    </div>`;
    return;
  }
  $('#view').innerHTML = '<div class="empty"><span class="spinner"></span> Loading Search Console…</div>';
  let d;
  try { d = await api.get('/gsc/recommendations?days=' + gscDays); }
  catch (e) { $('#view').innerHTML = `<div class="card"><h3>Search Console</h3><p class="badge failed">${esc(e.message)}</p><p class="muted">Check the property URL in Settings matches a property you own (e.g. <code>https://yoursite.com/</code> or <code>sc-domain:yoursite.com</code>).</p></div>`; return; }
  const pct = (n) => (n * 100).toFixed(1) + '%';
  const card = (t, v, s) => `<div class="card"><h3>${t}</h3><div class="stat">${v}</div><div class="stat-sub">${s||''}</div></div>`;
  const rows = (arr, key, label) => arr.length ? `<table><thead><tr><th>${label}</th><th>Clicks</th><th>Impr</th><th>CTR</th><th>Pos</th></tr></thead><tbody>
    ${arr.map((r) => `<tr><td>${esc(r[key])}</td><td>${r.clicks}</td><td>${r.impressions}</td><td>${pct(r.ctr)}</td><td>${r.position}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No data.</p>';

  $('#view').innerHTML = `
    <div class="tabs">${[7,28,90].map((n) => `<div class="tab ${gscDays===n?'active':''}" onclick="setGscDays(${n})">Last ${n} days</div>`).join('')}</div>
    <div class="grid cols-4">
      ${card('Clicks', d.totals.clicks, `${d.range.startDate} → ${d.range.endDate}`)}
      ${card('Impressions', d.totals.impressions, '')}
      ${card('Avg CTR', pct(d.totals.ctr), '')}
      ${card('Avg position', d.totals.position.toFixed(1), 'lower is better')}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head"><h2>🤖 AI recommendations — what to do about it</h2></div>
      ${d.advice && d.advice.length ? d.advice.map((a) => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <b>${esc(a.title)}</b> ${badge(a.priority||'medium')} <span class="badge">${esc(a.effort||'')}</span>
        <div class="muted" style="font-size:13px;margin-top:4px">${esc(a.detail)}</div></div>`).join('') : '<p class="muted">No recommendations generated (check AI connection).</p>'}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head"><h2>⚡ Striking-distance queries (ranking 8–20)</h2>
        <button class="btn success sm" onclick="strikingToIdeas()" ${d.striking.length?'':'disabled'}>Send all to article ideas</button></div>
      <p class="hint">These already rank on page 1–2. New/expanded articles targeting them are the fastest wins.</p>
      ${rows(d.striking, 'query', 'Query')}
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <div class="card"><h3>Top queries</h3>${rows(d.topQueries, 'query', 'Query')}</div>
      <div class="card"><h3>Top pages</h3>${rows(d.topPages, 'page', 'Page')}</div>
    </div>`;
  window.__striking = d.striking.map((s) => s.query);
};
window.setGscDays = (n) => { gscDays = n; views.searchconsole(); };

// ---- Pages: Index & Performance (autonomous data + live operations) --------
let idxTab = 'indexed';
let idxSort = 'easy';
window.setIdxTab = (t) => { idxTab = t; views.indexstatus(); };
window.setIdxSort = (s) => { idxSort = s; views.indexstatus(); };
function sortIndexed(list) {
  const a = list.slice();
  if (idxSort === 'impr') a.sort((x, y) => (y.impressions || 0) - (x.impressions || 0));
  else if (idxSort === 'pos') a.sort((x, y) => (x.position ?? 999) - (y.position ?? 999));
  else if (idxSort === 'worst') a.sort((x, y) => (y.position ?? 0) - (x.position ?? 0));
  else if (idxSort === 'decline') a.sort((x, y) => ((y.trend?.delta || 0) - (x.trend?.delta || 0)));
  else a.sort((x, y) => (Number(y.easyOptimize) - Number(x.easyOptimize)) || ((y.impressions || 0) - (x.impressions || 0)));
  return a;
}
// LIVE: pull fresh positions from Search Console now, with visible progress.
window.idxRefresh = async () => {
  const el = $('#idxLive');
  if (el) el.innerHTML = '<div class="callout"><span class="ico"><span class="spinner"></span></span><div><b>Pulling live positions from Google Search Console…</b><br><span class="muted" style="font-size:12px">This reads every page\'s position, impressions and clicks.</span></div></div>';
  try { const r = await api.post('/ranktrack/snapshot', { force: true }); toast(`Pulled ${r.rows} pages from Search Console`, 'success'); await views.indexstatus(); }
  catch (e) { if (el) el.innerHTML = `<div class="callout warn"><span class="ico">⚠️</span><div>${esc(e.message)}</div></div>`; toast(e.message, 'error'); }
};
// LIVE: check the unverified pages' index coverage one-by-one, updating as it goes.
window.idxCheckLive = async () => {
  let d; try { d = await api.get('/index/overview?range=' + idxRange); } catch (e) { return toast(e.message, 'error'); }
  const urls = [...(d.unchecked || []), ...(d.notIndexed || [])].map((x) => x.url);
  const el = $('#idxLive');
  if (!urls.length) { toast('No unverified pages to check 🎉', 'success'); return; }
  let done = 0, pass = 0;
  for (const url of urls) {
    if (el) el.innerHTML = `<div class="callout"><span class="ico"><span class="spinner"></span></span><div><b>Checking indexing live — ${done + 1}/${urls.length}</b>
      <div class="muted" style="font-size:12px">${esc(url)}</div>
      <div style="height:7px;border-radius:99px;background:#1d2634;overflow:hidden;margin-top:8px"><span style="display:block;height:100%;width:${Math.round(done / urls.length * 100)}%;background:var(--accent);transition:width .3s"></span></div>
      <span class="muted" style="font-size:11px">${pass} confirmed indexed so far</span></div></div>`;
    try { const r = await api.post('/indexmon/check', { url }); if (r && r.verdict === 'PASS') pass++; } catch { /* keep going */ }
    done++;
  }
  toast(`Checked ${done} page(s) live — ${pass} confirmed indexed`, 'success');
  await views.indexstatus();
};
function idxTrend(t) {
  if (!t) return '<span class="muted">—</span>';
  if (t.direction === 'up') return `<span style="color:#34d399" title="improved ${t.from}→${t.to}">▲ ${Math.abs(t.delta)}</span>`;
  if (t.direction === 'down') return `<span style="color:#f0685f" title="slipped ${t.from}→${t.to}">▼ ${Math.abs(t.delta)}</span>`;
  return '<span class="muted">flat</span>';
}
function idxMovement(m) {
  if (!m) return '';
  const up = m.delta > 0;
  return `<span class="badge ${up ? 'published' : m.delta < 0 ? 'failed' : ''}" title="position ${m.from}→${m.to}">since optimized: ${m.beforePos}→${m.afterPos} ${up ? '▲' : m.delta < 0 ? '▼' : ''}</span>`;
}
let idxRange = '28d';
window.setIdxRange = (r) => { idxRange = r; views.indexstatus(); };
const fmtN = (n) => n == null ? '–' : Number(n).toLocaleString();
views.indexstatus = async () => {
  let d;
  try { d = await api.get('/index/overview?range=' + encodeURIComponent(idxRange)); }
  catch (e) { $('#view').innerHTML = `<div class="callout warn"><span class="ico">⚠️</span><div>${esc(e.message)}</div></div>`; return; }
  if (d.range) idxRange = d.range;

  if (d.needsGsc) {
    $('#view').innerHTML = `<div class="callout warn"><span class="ico">🔌</span><div><b>Connect Google Search Console</b> to see your pages' real index status and performance. <button class="btn sm" onclick="connectGsc()">Connect Search Console</button></div></div>`;
    return;
  }
  if (d.needsReauth) {
    $('#view').innerHTML = `<div class="callout warn"><span class="ico">🔑</span><div>
      <b>Search Console needs reconnecting.</b> Your Google token expired (<code>${esc(d.error || 'token expired')}</code>) — this happens every 7 days while the Google OAuth consent screen is in <b>"Testing"</b> mode.
      <div style="margin-top:10px"><button class="btn" onclick="connectGsc()">🔑 Reconnect Search Console</button></div>
      <p class="hint" style="margin-top:8px"><b>To stop it expiring:</b> in Google Cloud Console → <i>OAuth consent screen</i> → set <b>Publishing status → In production</b>, then reconnect once. Your Client ID/Secret are fine — nothing to re-enter.</p></div></div>`;
    return;
  }
  if (d.error) { $('#view').innerHTML = `<div class="callout warn"><span class="ico">⚠️</span><div>${esc(d.error)}</div><div style="margin-top:8px"><button class="btn sm" onclick="connectGsc()">Reconnect Search Console</button></div></div>`; return; }

  const rangeLabel = (d.ranges.find((x) => x.id === idxRange) || {}).label || idxRange;
  const rangeSel = `<div class="seg">${d.ranges.map((x) => `<button class="seg-btn ${idxRange === x.id ? 'on' : ''}" onclick="setIdxRange('${x.id}')">${x.label}</button>`).join('')}</div>`;
  const pageCell = (r) => `<td><a class="title-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
    ${r.focusKeyword ? `<div><span class="badge" style="font-size:10px;background:var(--accent-soft);color:var(--accent)">🎯 ${esc(r.focusKeyword)}</span></div>` : ''}
    ${r.optimization && r.optimization.movement ? `<div style="margin-top:3px">${idxMovement(r.optimization.movement)}</div>` : (r.optimization ? `<div class="muted" style="font-size:11px;margin-top:3px">optimized (${esc(r.optimization.status)}) — measuring…</div>` : '')}</td>`;
  const m = (v) => v == null ? '<td class="muted">–</td>' : `<td>${fmtN(v)}</td>`;

  let body = '';
  if (idxTab === 'indexed') {
    const rows = sortIndexed(d.indexed).map((r) => `<tr${r.easyOptimize ? ' style="background:rgba(245,183,61,.08)"' : ''}>
      ${pageCell(r)}
      ${m(r.clicks)}${m(r.impressions)}<td>${r.ctr == null ? '–' : (r.ctr * 100).toFixed(1) + '%'}</td><td>${r.position == null ? '–' : r.position.toFixed(1)}</td>
      <td>${r.easyOptimize ? '<span class="badge" style="background:rgba(245,183,61,.18);color:#f5b73d">⚡ easy win</span>' : ''}</td>
      <td class="row-actions">
        <button class="btn sm secondary" onclick="wpAnalyzeUrl('${esc(r.url)}')" title="Compare vs the live Google top-10">🔬 Analyze</button>
        <button class="btn sm" onclick="optimizeLive('${esc(r.url)}','refresh')" title="Refresh & expand to satisfy near-ranking queries">📈 Refresh</button>
        <button class="btn sm success" onclick="optimizeLive('${esc(r.url)}','regenerate')" title="Full rewrite to a best-in-class article (rich components + gap analysis)">♻️ Regenerate</button>
      </td></tr>`).join('') || `<tr><td colspan="7" class="muted">No indexed pages with traffic in the last ${esc(rangeLabel)}.</td></tr>`;
    body = `<div class="table-scroll"><table><thead><tr><th>Page</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">Indexed = verified by URL Inspection <i>or</i> receiving impressions (Google can't show impressions for an unindexed page). Numbers are live from Search Console for the selected range. ⚡ easy wins = striking-distance pages — fastest to push to page one.</p>`;
  } else if (idxTab === 'notindexed') {
    const rows = d.notIndexed.map((r) => `<tr>
      ${pageCell(r)}
      <td><span class="badge failed">${esc(r.indexState)}</span>${r.checkedAt ? `<div class="muted" style="font-size:11px">checked ${esc(r.checkedAt.slice(0, 10))}</div>` : ''}</td>
      <td class="row-actions">
        <button class="btn sm" onclick="idxCheckOne('${esc(r.url)}')" title="Re-run URL Inspection now">🔄 Re-check</button>
        <a class="btn sm secondary" href="${esc(r.searchUrl)}" target="_blank" rel="noopener" title="Live site: search">🔎 Google</a>
        ${r.inspectUrl ? `<a class="btn sm secondary" href="${esc(r.inspectUrl)}" target="_blank" rel="noopener">Inspect</a>` : ''}
        <button class="btn sm secondary" onclick="reqIndex('${esc(r.url)}')" title="Ping the Indexing API">Request indexing</button>
      </td></tr>`).join('') || '<tr><td colspan="3" class="muted">No pages confirmed not-indexed. 🎉</td></tr>';
    body = `<div class="table-scroll"><table><thead><tr><th>Page</th><th>Index status (verified)</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">These returned a real <b>not-indexed</b> verdict from Google's URL Inspection. “Request indexing” pings the Indexing API (needs the service account in Settings → Indexing).</p>`;
  } else {
    const rows = d.unchecked.map((r) => `<tr>
      ${pageCell(r)}
      <td class="row-actions">
        <button class="btn sm" onclick="idxCheckOne('${esc(r.url)}')" title="Run URL Inspection now (live)">🔍 Check index now</button>
        <a class="btn sm secondary" href="${esc(r.searchUrl)}" target="_blank" rel="noopener">🔎 Google</a>
      </td></tr>`).join('') || '<tr><td colspan="2" class="muted">Nothing unchecked. 🎉</td></tr>';
    body = `<div class="table-scroll"><table><thead><tr><th>Page</th><th>Live indexing check</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">No Search Console traffic and not yet inspected — so we DON'T guess. Run a live URL Inspection to get the real verdict (or let the 24/7 worker do it over time).</p>`;
  }

  const sortSel = idxTab === 'indexed' ? `<select onchange="setIdxSort(this.value)" title="Sort mode">
      ${[['easy', '⚡ Easy wins first'], ['impr', 'Most impressions'], ['pos', 'Best position'], ['worst', 'Worst position']].map((o) => `<option value="${o[0]}" ${idxSort === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}
    </select>` : '';
  $('#view').innerHTML = `
    <div class="toolbar" style="gap:10px;flex-wrap:wrap;align-items:center">
      ${rangeSel}
      <div class="spacer"></div>
      <span class="muted" style="font-size:12.5px"><b>${fmtN(d.totals.clicks)}</b> clicks · <b>${fmtN(d.totals.impressions)}</b> impressions <span style="opacity:.7">(${esc(rangeLabel)}, from Search Console)</span></span>
    </div>
    <div class="toolbar" style="gap:8px;flex-wrap:wrap">
      <button class="btn sm" onclick="views.indexstatus()" title="Re-pull from Search Console">🔄 Refresh</button>
      <button class="btn sm secondary" onclick="idxCheckLive()" title="Inspect the unchecked/not-indexed pages live">🔍 Check indexing (live)</button>
      ${sortSel}
      <div class="spacer"></div>
      <span class="muted" style="font-size:12px">${d.counts.indexed} indexed · ${d.counts.notIndexed} not indexed · <b>${d.easyWins}</b> easy wins</span>
    </div>
    <div id="idxLive"></div>
    <div class="tabs">
      <div class="tab ${idxTab === 'indexed' ? 'active' : ''}" onclick="setIdxTab('indexed')">✅ Indexed (${d.counts.indexed})</div>
      <div class="tab ${idxTab === 'notindexed' ? 'active' : ''}" onclick="setIdxTab('notindexed')">🚫 Not indexed (${d.counts.notIndexed})</div>
      <div class="tab ${idxTab === 'unchecked' ? 'active' : ''}" onclick="setIdxTab('unchecked')">❔ Unchecked (${d.counts.unchecked})</div>
    </div>
    <div class="card" style="margin-top:12px">${body}</div>`;
};
// LIVE, INTERACTIVE optimize: prepare from GSC, then let the user apply / dismiss / retry.
window.optimizeLive = async (url, mode) => {
  modal('Optimizing…', `<div class="empty"><span class="spinner"></span> Preparing ${mode === 'ctr' ? 'a title/meta CTR rewrite' : 'a content refresh'} from Search Console data…<br><span class="muted" style="font-size:12px">${esc(url)}</span></div>`);
  let o;
  try { o = await api.post('/optimize/' + mode, { url }); }
  catch (e) { modal('Could not optimize', `<p class="badge failed">${esc(e.message)}</p><div class="inline" style="margin-top:12px;gap:8px"><button class="btn" onclick="optimizeLive('${esc(url)}','${mode}')">↻ Retry</button><button class="btn ghost" onclick="closeModal()">Close</button></div>`); return; }
  renderOptimization(o);
};
function renderOptimization(o) {
  const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
  const after = parse(o.after), before = parse(o.before);
  const words = (after.content || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  modal('Prepared optimization — review &amp; act', `
    <div class="muted" style="font-size:12px;margin:-6px 0 10px">${esc(o.type || '')} · <a href="${esc(o.target_url || '')}" target="_blank" rel="noopener">${esc(o.target_url || '')}</a></div>
    ${o.note ? `<p>${esc(o.note)}</p>` : ''}
    ${after.title && after.title !== before.title ? `<p><b>New title:</b> ${esc(after.title)}<br><span class="muted" style="font-size:12px">was: ${esc(before.title || '')}</span></p>` : ''}
    ${after.meta_description ? `<p><b>New meta description:</b> ${esc(after.meta_description)}</p>` : ''}
    ${after.content ? `<div class="section-head" style="margin-top:8px"><h3 style="margin:0">New content</h3><span class="muted" style="font-size:11px">${words} words</span></div><div class="wp-content-preview">${after.content}</div>` : ''}
    <div class="inline" style="margin-top:14px;flex-wrap:wrap;gap:8px">
      <button class="btn success" onclick="applyOptimization(${o.id})">✅ Apply to WordPress</button>
      <button class="btn ghost" onclick="dismissOptimization(${o.id})">🗑 Dismiss</button>
      <button class="btn ghost" onclick="closeModal()">Close</button>
    </div>
    <p class="hint" style="margin-top:8px">Applying writes the change to your live post. (If WordPress is blocked by your host's CDN, you'll see a clear message and can apply later once it's reachable.)</p>`);
}
window.applyOptimization = async (id) => {
  const t = toast('Applying to WordPress…', 'loading');
  try { await api.post('/optimize/' + id + '/apply'); t.done('Applied live ✓', 'success'); closeModal(); if (current === 'indexstatus') views.indexstatus(); }
  catch (e) { t.fail(e.message); }
};
window.dismissOptimization = async (id) => {
  try { await api.post('/optimize/' + id + '/dismiss'); toast('Dismissed', 'success'); closeModal(); }
  catch (e) { toast(e.message, 'error'); }
};
window.idxCheckOne = async (url) => {
  const t = toast('Inspecting in Google…', 'loading');
  try { const r = await api.post('/indexmon/check', { url }); t.done(r.verdict === 'PASS' ? '✅ Indexed' : `Not indexed — ${r.coverage || r.verdict}`, r.verdict === 'PASS' ? 'success' : 'error'); await views.indexstatus(); }
  catch (e) { t.fail(e.message); }
};
window.reqIndex = async (url) => {
  const t = toast('Requesting indexing…', 'loading');
  try { await api.post('/indexmon/submit', { url }); t.done('Submitted to Google Indexing API', 'success'); }
  catch (e) { t.fail(e.message); }
};
window.connectGsc = async () => {
  try { const { url } = await api.get('/gsc/auth-url'); window.open(url, '_blank', 'width=520,height=640'); toast('Complete sign-in in the popup, then refresh', 'success'); }
  catch (e) { toast(e.message, 'error'); }
};
window.strikingToIdeas = async () => {
  const r = await api.post('/gsc/to-ideas', { queries: window.__striking || [] });
  toast(`Added ${r.added} article ideas`, 'success');
};

// ---- Opportunities (GSC → WordPress) --------------------------------------
const OPP_META = {
  ctr: { icon: '🎯', label: 'Low CTR', tip: 'Ranks well but few clicks — rewrite title & meta.' },
  refresh: { icon: '📈', label: 'Striking distance', tip: 'Page 2 — refresh & expand to reach page 1.' },
  regenerate: { icon: '♻️', label: 'Full regenerate', tip: 'Complete best-in-class rewrite with rich components + gap analysis.' },
  gap: { icon: '🧩', label: 'Content gap', tip: 'Demand with no dedicated page — create one.' },
  cannibal: { icon: '⚔️', label: 'Cannibalization', tip: 'Multiple pages compete for one query.' },
  destuff: { icon: '🧹', label: 'Reduce density', tip: 'Keyword over-optimised — de-stuff to the target density.' },
};
views.optimize = async () => {
  $('#view').innerHTML = `
    <div class="card">
      <div class="section-head"><h2>GSC → WordPress opportunities</h2>
        <button class="btn" onclick="scanOpps()">🔄 Scan Search Console</button></div>
      <p class="hint">Finds the highest-impact fixes from your live Search Console data and turns them into WordPress edits you approve.</p>
      <div id="oppResults"><div class="empty">Click “Scan Search Console” to find opportunities.</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head"><h2>Prepared optimizations</h2><button class="btn sm secondary" onclick="loadOpts()">Refresh</button></div>
      <div id="optList"><div class="empty">No prepared optimizations yet.</div></div>
    </div>`;
  loadOpts();
};
window.scanOpps = async () => {
  const el = $('#oppResults');
  el.innerHTML = '<div class="empty"><span class="spinner"></span> Scanning Search Console…</div>';
  let d;
  try { d = await api.post('/optimize/scan', { days: 28 }); }
  catch (e) { el.innerHTML = `<p class="badge failed">${esc(e.message)}</p>`; return; }
  if (!d.opportunities.length) { el.innerHTML = '<div class="empty">No opportunities found in the last 28 days — nice. Try again as more data accrues.</div>'; return; }
  const grouped = {};
  d.opportunities.forEach((o) => (grouped[o.type] = grouped[o.type] || []).push(o));
  el.innerHTML = Object.entries(grouped).map(([type, items]) => {
    const m = OPP_META[type];
    return `<div style="margin-bottom:14px"><h3>${m.icon} ${m.label} (${items.length}) <span class="muted" style="font-weight:400">— ${m.tip}</span></h3>
      <table><thead><tr><th>${type === 'gap' || type === 'cannibal' ? 'Query' : 'Page'}</th><th>Impr</th><th>Pos</th><th>CTR</th><th>~clicks/mo</th><th></th></tr></thead><tbody>
      ${items.map((o) => `<tr>
        <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis">${esc(o.query || o.url)}</td>
        <td>${o.impressions ?? '–'}</td><td>${o.position ?? '–'}</td><td>${o.ctr != null ? (o.ctr * 100).toFixed(1) + '%' : '–'}</td>
        <td>${o.gain ? '+' + o.gain : '–'}</td>
        <td class="row-actions">${oppAction(type, o)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('');
};
function oppAction(type, o) {
  if (type === 'ctr') return `<button class="btn sm" onclick="prepCtr('${encodeURIComponent(o.url)}')">Prepare fix</button>`;
  if (type === 'refresh') return `<button class="btn sm" onclick="prepRefresh('${encodeURIComponent(o.url)}')">Prepare refresh</button>`;
  if (type === 'gap') return `<button class="btn sm success" onclick="gapIdea('${esc((o.query||'').replace(/'/g,''))}')">Create article</button>`;
  if (type === 'cannibal') return `<button class="btn sm ghost" onclick='showCannibal(${JSON.stringify(o.pages||[])})'>View pages</button>`;
  return '';
}
window.prepCtr = async (u) => { toast('Writing a higher-CTR title & meta…'); try { await api.post('/optimize/ctr', { url: decodeURIComponent(u) }); toast('Prepared — review below','success'); loadOpts(); } catch (e) { toast(e.message,'error'); } };
window.prepRefresh = async (u) => { toast('Refreshing content (can take ~30s)…'); try { await api.post('/optimize/refresh', { url: decodeURIComponent(u) }); toast('Prepared — review below','success'); loadOpts(); } catch (e) { toast(e.message,'error'); } };
window.gapIdea = async (q) => { try { await api.post('/optimize/gap', { query: q }); toast('Added to article ideas','success'); } catch (e) { toast(e.message,'error'); } };
window.showCannibal = (pages) => modal('Competing pages', `<p class="muted">These pages all rank for the same query. Consolidate them or differentiate their focus keywords:</p><ul>${pages.map((p)=>`<li><a href="${esc(p)}" target="_blank">${esc(p)}</a></li>`).join('')}</ul>`);

async function loadOpts() {
  const el = $('#optList'); if (!el) return;
  const list = await api.get('/optimize/list');
  if (!list.length) { el.innerHTML = '<div class="empty">No prepared optimizations yet. Scan and prepare a fix above.</div>'; return; }
  el.innerHTML = `<table><thead><tr><th>Type</th><th>Target</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((o) => `<tr>
      <td>${OPP_META[o.type]?.icon||''} ${esc(o.type)}</td>
      <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis">${esc(o.target_url || o.query || '')}</td>
      <td>${badge(o.status === 'applied' ? 'published' : o.status === 'prepared' ? 'pending_review' : 'idea')}</td>
      <td class="row-actions">
        <button class="btn sm secondary" onclick="viewOpt(${o.id})">Review</button>
        ${o.status === 'prepared' ? `<button class="btn sm success" onclick="applyOpt(${o.id})">Apply to WP</button>` : ''}
        ${o.status !== 'applied' ? `<button class="btn sm ghost" onclick="dismissOpt(${o.id})">✕</button>` : ''}
      </td></tr>`).join('')}
  </tbody></table>`;
}
window.viewOpt = async (id) => {
  const o = await api.get('/optimize/' + id);
  const b = o.before || {}, a = o.after || {};
  const diff = (label, before, after) => after != null ? `<div style="margin-bottom:12px"><b>${label}</b>
    <div class="preview" style="border-color:var(--danger)"><span class="muted">Before:</span> ${esc(before || '(empty)')}</div>
    <div class="preview" style="border-color:var(--accent-2);margin-top:6px"><span class="muted">After:</span> ${esc(after)}</div></div>` : '';
  modal(`${OPP_META[o.type]?.icon||''} ${o.type} — ${esc(o.target_url||o.query||'')}`, `
    ${o.note ? `<p class="muted">${esc(o.note)}</p>` : ''}
    ${diff('SEO title', b.title, a.title)}
    ${diff('Meta description', b.meta_description, a.meta_description)}
    ${a.content ? `<div><b>Refreshed content</b><div class="preview" style="max-height:280px">${esc(a.content.slice(0,4000))}${a.content.length>4000?'…':''}</div></div>` : ''}
    <div class="inline" style="margin-top:12px">
      ${o.status === 'prepared' ? `<button class="btn success" onclick="closeModal();applyOpt(${id})">Apply to WordPress</button>` : ''}
      ${o.status !== 'applied' ? `<button class="btn ghost" onclick="closeModal();dismissOpt(${id})">Dismiss</button>` : ''}
      <button class="btn ghost" onclick="closeModal()">Close</button>
    </div>`);
};
window.applyOpt = async (id) => { toast('Pushing change to WordPress…'); try { await api.post(`/optimize/${id}/apply`); toast('Applied live!','success'); loadOpts(); } catch (e) { toast(e.message,'error'); } };
window.dismissOpt = async (id) => { await api.post(`/optimize/${id}/dismiss`); loadOpts(); };

// ---- Site: themes & plugins ----------------------------------------------
let wpSub = 'overview';
const wpState = {
  posts: { page: 1, search: '', status: 'any', orderby: 'date', order: 'desc', perPage: 20 },
  pages: { page: 1, search: '', status: 'any', orderby: 'date', order: 'desc', perPage: 20 },
  media: { page: 1, search: '' },
  comments: { page: 1, status: '' },
};
views.site = async () => {
  const subs = [['overview', '🩺 Overview'], ['posts', '📝 Posts'], ['pages', '📄 Pages'], ['media', '🖼 Media'], ['comments', '💬 Comments'], ['plugins', '🔌 Plugins'], ['themes', '🎨 Themes']];
  $('#view').innerHTML = `${pipelineFlow('site')}<div class="subtabs">${subs.map(([k, l]) => `<button class="subtab ${wpSub === k ? 'active' : ''}" onclick="wpGo('${k}')">${l}</button>`).join('')}</div><div id="wpHub"></div>`;
  renderWpSub();
};
window.wpGo = (sub) => { wpSub = sub; views.site(); };
function renderWpSub() {
  const fns = { overview: wpOverview, posts: () => wpContent('posts'), pages: () => wpContent('pages'), media: wpMedia, comments: wpComments, plugins: wpPlugins, themes: wpThemes };
  (fns[wpSub] || wpOverview)();
}
function hubLoading() { $('#wpHub').innerHTML = '<div class="empty"><span class="spinner"></span> Loading…</div>'; }

async function wpOverview() {
  hubLoading();
  const [settings, seo] = await Promise.all([
    api.get('/wp/settings').catch((e) => ({ _err: e.message })),
    api.get('/wp/seo-detect').catch(() => null),
  ]);
  const ok = (b) => b ? '<span class="badge published">yes</span>' : '<span class="badge failed">no</span>';
  let seoCard = '';
  if (seo) {
    const rm = seo.rankMath;
    seoCard = `<div class="card" style="margin-top:16px"><div class="section-head"><h2>SEO plugin</h2></div>
      ${rm ? `<p class="muted"><b style="color:var(--text)">${esc(rm.name)}</b> v${esc(rm.version)} — ${rm.active ? '<span class="badge published">active</span>' : '<span class="badge failed">inactive</span>'}
        ${seo.rankMathPro ? ` · <b>PRO</b> v${esc(seo.rankMathPro.version)} ${seo.rankMathPro.active ? '<span class="badge published">active</span>' : ''}` : ''}</p>`
        : (seo.yoast ? `<p class="muted"><b>${esc(seo.yoast.name)}</b> (Yoast) active</p>` : '<p class="badge pending_review">No SEO plugin detected — install Rank Math (Plugins tab).</p>')}
      <p style="font-size:13px">Live score readable over REST: ${ok(seo.nativeScoreReadable || seo.bridge)} ${seo.bridge ? '<span class="badge published">via SEO Bridge</span>' : seo.nativeScoreReadable ? '<span class="badge published">native</span>' : ''}</p>
      ${!(seo.nativeScoreReadable || seo.bridge) && rm ? `<p class="hint">Rank Math computes its score in the editor (not via REST), so posts created by the API have no stored score until opened in the editor. We score generated posts ourselves against Rank Math's exact criteria. To also read live scores of <i>human-edited</i> posts, optionally <a href="#" onclick="bridgeHelp();return false">install the SEO Bridge</a> (<a href="#" onclick="bridgeHelp();return false">how</a>).</p>` : ''}
    </div>`;
  }
  $('#wpHub').innerHTML = `<div class="card">
      <div class="section-head"><h2>Site overview</h2><button class="btn" onclick="wpDiagnostics()">🩺 Run full diagnostics</button></div>
      ${!settings._err ? `<p class="muted"><b style="color:var(--text);font-size:15px">${esc(settings.title || '')}</b> — ${esc(settings.description || '')}<br>
        ${esc(settings.url || '')} · ${esc(settings.language || '')} · ${esc(settings.timezone_string || '')}</p>`
      : `<p class="badge failed">${esc(settings._err)}</p><p class="muted">Run diagnostics to see capabilities, or check the connection in Settings.</p>`}
      <p class="hint">Use the tabs above to browse and operate on everything in your WordPress site.</p>
    </div>${seoCard}`;
}

// Generic paginated content browser (posts / pages).
async function wpContent(type) {
  hubLoading();
  const st = wpState[type];
  let data;
  try { data = await api.get(`/wp/content/${type}?page=${st.page}&status=${st.status}&search=${encodeURIComponent(st.search)}&orderby=${st.orderby || 'date'}&order=${st.order || 'desc'}&per_page=${st.perPage || 20}`); }
  catch (e) { $('#wpHub').innerHTML = `<div class="card"><p class="badge failed">${esc(e.message)}</p></div>`; return; }
  const statuses = ['any', 'publish', 'draft', 'pending', 'future', 'private'];
  // Live Rank Math scores for the visible items (one bulk call via the bridge plugin).
  let rmScores = null, rmFocus = null, bridge = false;
  try {
    const r = await api.get(`/wp/rankmath-scores?ids=${data.items.map((p) => p.id).join(',')}`);
    bridge = r.bridge;
    if (bridge) { rmScores = {}; rmFocus = {}; r.scores.forEach((x) => { rmScores[x.id] = x.score; rmFocus[x.id] = x.focus_keyword || ''; }); }
  } catch { /* ignore */ }
  const rmCell = (id) => {
    if (!bridge) return '<td class="muted">–</td>';
    const sc = rmScores[id];
    return sc == null ? '<td class="muted" title="no stored score">–</td>' : `<td>${seoPill(sc)}</td>`;
  };
  // Focus keyword from Rank Math (via the bridge); fall back to the slug.
  const focusCell = (p) => {
    const fk = bridge && rmFocus ? rmFocus[p.id] : '';
    if (fk) return `<td><span class="badge cell-ellipsis" style="font-size:10px;background:var(--accent-soft);color:var(--accent)" title="Rank Math focus keyword: ${esc(fk)}">🎯 ${esc(fk)}</span></td>`;
    const guess = (p.slug || '').replace(/-/g, ' ').trim();
    return guess ? `<td><span class="muted cell-ellipsis" style="font-size:11px" title="from slug (no Rank Math focus keyword): ${esc(guess)}">${esc(guess)}</span></td>` : '<td class="muted">–</td>';
  };
  const rows = data.items.map((p) => `<tr>
    <td><a class="title-link" onclick="wpDetail('${type}',${p.id})" title="Open details">${esc(p.title)}</a>${p.slug ? `<div class="muted" style="font-size:11px">/${esc(p.slug)}</div>` : ''}</td>
    <td>${badge(p.status === 'publish' ? 'published' : p.status === 'draft' ? 'idea' : 'pending_review')}</td>
    ${focusCell(p)}
    ${rmCell(p.id)}
    <td class="muted" style="font-size:12px;white-space:nowrap">${esc((p.date || '').slice(0, 10))}</td>
    <td class="row-actions">
      <button class="btn sm" onclick="wpDetail('${type}',${p.id})" title="View details">Details</button>
      ${p.link ? `<a class="btn sm ghost" href="${esc(p.link)}" target="_blank" rel="noopener" title="Open live">↗</a>` : ''}
      ${actionMenu([
        { label: '🔍 View details', onclick: `wpDetail('${type}',${p.id})` },
        p.status !== 'publish' ? { label: '✅ Publish', onclick: `wpSetStatus('${type}',${p.id},'publish')` } : { label: '📥 Switch to draft', onclick: `wpSetStatus('${type}',${p.id},'draft')` },
        ...(type === 'posts' ? [
          { label: '🎯 Optimize CTR (GSC)', onclick: `wpOptimize('${esc(p.link)}','ctr')` },
          { label: '📈 Refresh content (GSC)', onclick: `wpOptimize('${esc(p.link)}','refresh')` },
          { label: '🧹 Reduce keyword density', onclick: `destuffPost('${esc(p.link)}')` },
        ] : []),
        '-',
        { label: '🗑 Move to trash', onclick: `wpTrash('${type}',${p.id})`, danger: true },
      ])}
    </td></tr>`).join('');
  const limitBanner = data.limited ? `<div class="bulkbar" style="border-color:var(--warn)">⚠️ <b>Read-only:</b> the connected WordPress user can't edit content, so only published items show and write actions (publish, trash, optimize) will fail. Reconnect with an <b>Administrator</b> Application Password — run <a href="#" onclick="wpDiagnostics();return false">diagnostics</a> to confirm.</div>` : '';
  const bridgeBanner = (type === 'posts' && !bridge) ? `<div class="bulkbar"><span class="muted" style="font-size:12px">ℹ️ The <b>Rank Math</b> column shows live scores for posts edited in WordPress. Posts we generate are scored against Rank Math's criteria before publishing. To also read live scores via REST, optionally <a href="#" onclick="bridgeHelp();return false">install the SEO Bridge</a>.</span>
    <div class="spacer"></div><button class="btn sm ghost" onclick="bridgeHelp()">How</button></div>` : '';
  $('#wpHub').innerHTML = `<div class="card">
    ${limitBanner}${bridgeBanner}
    <div class="toolbar" style="gap:8px;flex-wrap:wrap">
      <input type="search" id="wpSearch" placeholder="Search ${type}…" value="${esc(st.search)}" onkeydown="if(event.key==='Enter')wpSearchGo('${type}')"/>
      <button class="btn sm" onclick="wpSearchGo('${type}')">Search</button>
      <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:5px">Status
        <select id="wpStatusSel" onchange="wpStatusGo('${type}')">${statuses.map((s) => `<option ${st.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:5px">Sort
        <select onchange="wpSortGo('${type}',this.value)">
          ${[['date|desc', 'Newest'], ['date|asc', 'Oldest'], ['title|asc', 'Title A–Z'], ['title|desc', 'Title Z–A'], ['modified|desc', 'Recently updated']].map((o) => `<option value="${o[0]}" ${(st.orderby + '|' + st.order) === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}
        </select></label>
      <label class="muted" style="font-size:12px;display:flex;align-items:center;gap:5px">Per page
        <select onchange="wpPerPageGo('${type}',this.value)">${[10, 20, 50, 100].map((n) => `<option ${st.perPage === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="spacer"></div>
      <span class="muted" style="font-size:12px">${data.total} ${type}${st.search ? ` matching “${esc(st.search)}”` : ''}</span>
    </div>
    ${data.items.length ? `<div class="table-scroll"><table><thead><tr><th>Title</th><th>Status</th><th>Focus keyword</th><th>Rank Math</th><th>Date</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">No ' + type + ' found.</div>'}
    ${pager(data, 'wpPage_' + type)}
  </div>`;
}

// Detail view for a single WordPress post/page — content, focus keyword, Rank
// Math, links and quick actions.
window.wpDetail = async (type, id) => {
  modal('Loading…', '<div class="empty"><span class="spinner"></span> Loading details…</div>');
  let d;
  try { d = await api.get(`/wp/item/${type}/${id}`); }
  catch (e) { modal('Could not load', `<p class="badge failed">${esc(e.message)}</p><div class="inline"><button class="btn ghost" onclick="closeModal()">Close</button></div>`); return; }
  const rm = d.rankMath || {};
  const wpAdmin = d.link ? d.link.split('/').slice(0, 3).join('/') + `/wp-admin/post.php?post=${d.id}&action=edit` : '';
  const meta = [
    rm.focusKeyword ? `<span class="badge" style="background:var(--accent-soft);color:var(--accent)">🎯 ${esc(rm.focusKeyword)}</span>` : '',
    rm.score != null ? `Rank Math ${seoPill(rm.score)}` : '',
    `<span class="badge ${d.status === 'publish' ? 'published' : 'pending_review'}">${esc(d.status)}</span>`,
  ].filter(Boolean).join(' &nbsp; ');
  modal(esc(d.title), `
    <div class="muted" style="font-size:12px;margin:-6px 0 10px">/${esc(d.slug || '')} · ${esc((d.date || '').slice(0, 10))}${d.modified ? ` · updated ${esc(d.modified.slice(0, 10))}` : ''}</div>
    <div style="margin-bottom:12px">${meta}</div>
    ${rm.description ? `<p class="muted" style="font-size:13px"><b>Meta description:</b> ${esc(rm.description)}</p>` : (d.excerpt ? `<p class="muted" style="font-size:13px">${esc(d.excerpt.slice(0, 220))}</p>` : '')}
    <div class="section-head" style="margin-top:10px"><h3 style="margin:0">Content</h3><span class="muted" style="font-size:11px">${(d.content || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length} words</span></div>
    <div class="wp-content-preview">${d.content || '<span class="muted">No content available.</span>'}</div>
    <div class="inline" style="margin-top:14px;flex-wrap:wrap;gap:8px">
      ${d.link ? `<a class="btn" href="${esc(d.link)}" target="_blank" rel="noopener">↗ View live</a>` : ''}
      ${wpAdmin ? `<a class="btn secondary" href="${esc(wpAdmin)}" target="_blank" rel="noopener">✏️ Edit in WordPress</a>` : ''}
      ${type === 'posts' && d.link ? `<button class="btn secondary" onclick="closeModal();wpAnalyzeUrl('${esc(d.link)}')">🔬 Analyze gaps</button>
      <button class="btn success" onclick="closeModal();optimizeLive('${esc(d.link)}','regenerate')" title="Full rewrite with rich components + gap analysis">♻️ Regenerate</button>
      <button class="btn ghost" onclick="closeModal();optimizeLive('${esc(d.link)}','refresh')">📈 Refresh</button>
      <button class="btn ghost" onclick="closeModal();optimizeLive('${esc(d.link)}','ctr')">🎯 CTR</button>` : ''}
      <button class="btn ghost" onclick="closeModal()">Close</button>
    </div>`);
};
// Run the SERP content-gap analysis on a live post URL and show it in a modal.
window.wpAnalyzeUrl = async (url) => {
  modal('Analyzing…', '<div class="empty"><span class="spinner"></span> Searching Google’s top 10 &amp; comparing (~20-40s)…</div>');
  try {
    const d = await api.post('/intel/analyze', { url });
    modal(`Content-gap analysis — “${esc(d.keyword || '')}”`, `<div id="intelPanel"></div><div class="inline" style="margin-top:12px"><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
    const el = document.getElementById('intelPanel'); if (el && typeof renderIntel === 'function') el.innerHTML = renderIntel(d, 0);
  } catch (e) { modal('Analysis failed', `<p class="badge failed">${esc(e.message)}</p><div class="inline"><button class="btn ghost" onclick="closeModal()">Close</button></div>`); }
};
window.bridgeHelp = () => modal('Install the SEO Bridge plugin', `
  <p>This companion plugin lets WP Autopilot read the <b>real Rank Math score</b> AND write the full SEO meta set (focus kw, title, description, canonical, OG/Twitter, schema, primary category, Astra layout) over the REST API.</p>
  <p><b>Easiest — install as a normal plugin (recommended):</b></p>
  <ol style="line-height:1.9;font-size:14px">
    <li><a href="/wp-autopilot-seo.zip" download>Download <b>wp-autopilot-seo.zip</b></a></li>
    <li>In WP Admin → <b>Plugins → Add New → Upload Plugin</b> → choose the zip → <b>Install Now</b> → <b>Activate</b>.</li>
    <li>Reload this tab — the Rank Math column will populate and full-meta publishing will work.</li>
  </ol>
  <p class="hint" style="margin-top:14px"><b>Alternative — drop the raw <code>.php</code> into <code>wp-content/mu-plugins/</code></b> (via cPanel / SFTP / WP File Manager). It activates automatically with no Plugins screen entry: <a href="/wp-autopilot-seo.php" download>download <b>wp-autopilot-seo.php</b></a>.</p>
  <p class="hint">Read-safe by default: only exposes Rank Math meta over REST. Writes require an authenticated user with <code>edit_posts</code> capability.</p>
  <div class="inline"><a class="btn" href="/wp-autopilot-seo.zip" download>⬇ Download .zip (recommended)</a><a class="btn ghost" href="/wp-autopilot-seo.php" download>or raw .php</a><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
window['wpPage_posts'] = (p) => { wpState.posts.page = p; wpContent('posts'); };
window['wpPage_pages'] = (p) => { wpState.pages.page = p; wpContent('pages'); };
window.wpSearchGo = (type) => { wpState[type].search = $('#wpSearch').value.trim(); wpState[type].page = 1; wpContent(type); };
window.wpStatusGo = (type) => { wpState[type].status = $('#wpStatusSel').value; wpState[type].page = 1; wpContent(type); };
window.wpSortGo = (type, val) => { const [orderby, order] = String(val).split('|'); wpState[type].orderby = orderby; wpState[type].order = order; wpState[type].page = 1; wpContent(type); };
window.wpPerPageGo = (type, n) => { wpState[type].perPage = +n || 20; wpState[type].page = 1; wpContent(type); };
window.wpSetStatus = async (type, id, status) => { try { await api.post(`/wp/${type}/${id}/status`, { status }); toast(`Set to ${status}`, 'success'); wpContent(type); } catch (e) { toast(e.message, 'error'); } };
window.wpTrash = async (type, id) => { if (!confirm('Move this to trash on WordPress?')) return; try { await api.del(`/wp/${type}/${id}`); toast('Moved to trash', 'success'); wpContent(type); } catch (e) { toast(e.message, 'error'); } };
window.wpOptimize = async (url, mode) => { toast('Preparing optimization…'); try { await api.post('/optimize/' + mode, { url }); toast('Prepared — see Opportunities', 'success'); } catch (e) { toast(e.message, 'error'); } };

// One-click "de-stuff": reduce keyword density on a live post. Prepares the fix,
// shows before→after density, and applies on confirm.
window.destuffPost = async (url) => {
  if (!url) return toast('No live URL for this post.', 'error');
  modal('🧹 Reduce keyword density', '<div class="empty"><span class="spinner"></span> Analysing density &amp; rewriting (~30s)…</div>');
  let o;
  try { o = await api.post('/optimize/destuff', { url }); }
  catch (e) { $('#modalBody').innerHTML = `<p class="badge failed">${esc(e.message)}</p><div class="inline" style="margin-top:10px"><button class="btn ghost" onclick="closeModal()">Close</button></div>`; return; }
  if (o.alreadyOk) {
    $('#modalBody').innerHTML = `<p>✅ Density is already within target: <b>${o.density}%</b> (${o.kwCount} uses for "${esc(o.keyword)}"). Nothing to fix.</p>
      <div class="inline" style="margin-top:10px"><button class="btn ghost" onclick="closeModal()">Close</button></div>`;
    return;
  }
  const m = o.metrics || {};
  $('#modalBody').innerHTML = `
    <p style="font-size:13px">Focus keyword <b>"${esc(m.keyword || '')}"</b></p>
    <div class="inline" style="gap:16px;margin:8px 0">
      <div class="card" style="margin:0;border-color:var(--danger);flex:1"><div class="muted" style="font-size:12px">Before</div><div class="stat" style="font-size:22px">${m.densityBefore}%</div><div class="stat-sub">${m.kwBefore} exact uses</div></div>
      <div style="align-self:center;font-size:20px">→</div>
      <div class="card" style="margin:0;border-color:var(--accent-2);flex:1"><div class="muted" style="font-size:12px">After</div><div class="stat" style="font-size:22px">${m.densityAfter}%</div><div class="stat-sub">${m.kwAfter} exact uses</div></div>
    </div>
    ${o.note ? `<p class="muted" style="font-size:12px">${esc(o.note)}</p>` : ''}
    <p class="hint">Content length preserved (${m.words} words). Review the full rewrite, then push it live.</p>
    <div class="inline" style="margin-top:10px">
      <button class="btn success" onclick="closeModal();applyOpt(${o.id})">✓ Apply to WordPress</button>
      <button class="btn secondary" onclick="viewOpt(${o.id})">Review full diff</button>
      <button class="btn ghost" onclick="closeModal();dismissOpt(${o.id})">Discard</button>
    </div>`;
};

async function wpMedia() {
  hubLoading();
  const st = wpState.media;
  let data;
  try { data = await api.get(`/wp/content/media?page=${st.page}&search=${encodeURIComponent(st.search)}`); }
  catch (e) { $('#wpHub').innerHTML = `<div class="card"><p class="badge failed">${esc(e.message)}</p></div>`; return; }
  $('#wpHub').innerHTML = `<div class="card">
    <div class="toolbar"><input type="search" id="wpSearch" placeholder="Search media…" value="${esc(st.search)}" onkeydown="if(event.key==='Enter')wpMediaSearch()"/>
      <button class="btn sm" onclick="wpMediaSearch()">Search</button><div class="spacer"></div><span class="muted">${data.total} files</span></div>
    ${data.items.length ? `<div class="media-grid">${data.items.map((m) => `<div class="media-item">
      ${/image/.test(m.mime || '') ? `<img src="${esc(m.source_url)}" loading="lazy" alt=""/>` : '<div style="height:110px;display:grid;place-items:center;color:var(--muted)">📄</div>'}
      <div class="mi-body"><span class="mi-title" title="${esc(m.title)}">${esc(m.title)}</span>
        <span class="menu-wrap"><button class="icon-btn" onclick="toggleMenu(this)">⋯</button><div class="menu" style="display:none">
          <button onclick="closeMenus();window.open('${esc(m.source_url)}','_blank')">Open</button>
          <button class="danger" onclick="closeMenus();wpDelMedia(${m.id})">Delete</button></div></span></div>
    </div>`).join('')}</div>` : '<div class="empty">No media found.</div>'}
    ${pager(data, 'wpPageMedia')}
  </div>`;
}
window.wpPageMedia = (p) => { wpState.media.page = p; wpMedia(); };
window.wpMediaSearch = () => { wpState.media.search = $('#wpSearch').value.trim(); wpState.media.page = 1; wpMedia(); };
window.wpDelMedia = async (id) => { if (!confirm('Permanently delete this media file?')) return; try { await api.del(`/wp/media/${id}`); toast('Deleted', 'success'); wpMedia(); } catch (e) { toast(e.message, 'error'); } };

async function wpComments() {
  hubLoading();
  let data;
  try { data = await api.get('/wp/content/comments'); }
  catch (e) { $('#wpHub').innerHTML = `<div class="card"><p class="badge failed">${esc(e.message)}</p></div>`; return; }
  $('#wpHub').innerHTML = `<div class="card"><div class="section-head"><h2>Comments (${data.total})</h2></div>
    ${data.items.length ? `<table><thead><tr><th>Author</th><th>Comment</th><th>Status</th><th></th></tr></thead><tbody>
      ${data.items.map((c) => `<tr><td>${esc(c.title)}</td><td class="muted" style="font-size:12px">${esc(c.excerpt)}</td>
        <td>${badge(c.status === 'approved' ? 'published' : c.status === 'spam' ? 'failed' : 'pending_review')}</td>
        <td class="row-actions">${c.status !== 'approved' ? `<button class="btn sm success" onclick="moderateComment(${c.id},'approved')">Approve</button>` : ''}
          <button class="btn sm ghost" onclick="moderateComment(${c.id},'spam')">Spam</button>
          <button class="btn sm ghost" onclick="moderateComment(${c.id},'trash')">Trash</button></td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No comments.</div>'}</div>`;
}
window.moderateComment = async (id, status) => { try { await api.post(`/wp/comments/${id}/moderate`, { status }); toast(`Comment ${status}`, 'success'); wpComments(); } catch (e) { toast(e.message, 'error'); } };

async function wpPlugins() {
  hubLoading();
  let plugins = [], err = '';
  try { plugins = await api.get('/wp/plugins'); } catch (e) { err = e.message; }
  $('#wpHub').innerHTML = `<div class="card">
    <h3>Install a plugin from wordpress.org</h3>
    <div class="inline"><label class="field" style="flex:1"><span>Plugin slug</span><input id="pluginSlug" placeholder="e.g. wordpress-seo, seo-by-rank-math"/></label>
      <button class="btn" onclick="installPlugin()">Install &amp; activate</button></div>
    <p class="hint">Slug = last part of the wordpress.org URL (…/plugins/<b>slug</b>/).</p>
    ${err ? `<p class="badge failed">${esc(err)}</p><p class="muted">Needs an admin app-password and a host that allows file modifications.</p>` : ''}
    ${plugins.length ? `<table style="margin-top:12px"><thead><tr><th>Plugin</th><th>Status</th><th></th></tr></thead><tbody>
      ${plugins.map((p) => `<tr><td>${esc(p.name)} <span class="muted" style="font-size:11px">v${esc(p.version || '')}</span></td>
        <td>${badge(p.status === 'active' ? 'published' : 'idea')}</td>
        <td class="row-actions"><button class="btn sm ${p.status === 'active' ? 'ghost' : 'success'}" onclick="togglePlugin('${esc(p.plugin)}', ${p.status !== 'active'})">${p.status === 'active' ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')}
    </tbody></table>` : ''}</div>`;
}
window.installPlugin = async () => { const slug = $('#pluginSlug').value.trim(); if (!slug) return toast('Enter a slug', 'error'); toast('Installing…'); try { await api.post('/wp/plugins/install', { slug }); toast('Installed & activated', 'success'); wpPlugins(); } catch (e) { toast(e.message, 'error'); } };
window.togglePlugin = async (plugin, active) => { try { await api.post('/wp/plugins/toggle', { plugin, active }); toast(active ? 'Activated' : 'Deactivated', 'success'); wpPlugins(); } catch (e) { toast(e.message, 'error'); } };

async function wpThemes() {
  hubLoading();
  let themes = [], err = '';
  try { themes = await api.get('/wp/themes'); } catch (e) { err = e.message; }
  $('#wpHub').innerHTML = `<div class="card"><div class="section-head"><h2>Themes (${themes.length})</h2></div>
    ${err ? `<p class="badge failed">${esc(err)}</p>` : ''}
    ${themes.length ? `<table><thead><tr><th>Theme</th><th>Status</th></tr></thead><tbody>
      ${themes.map((t) => `<tr><td>${esc(t.name)} <span class="muted" style="font-size:11px">v${esc(t.version || '')}</span></td><td>${badge(t.status === 'active' ? 'published' : 'idea')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No themes.</div>'}
    <p class="hint">Switching the active theme isn't exposed by the WordPress REST API (do it in WP Admin → Appearance). Page layouts are edited in the Pages tab.</p></div>`;
}

// ---- Supabase (cloud persistence) settings actions ------------------------
window.supabaseTest = async () => {
  const t = toast('Testing Supabase…', 'loading');
  try { const r = await api.post('/supabase/test'); t.done(r.ok ? `Connected ✓ (workspace: ${r.workspace})` : 'Not configured', r.ok ? 'success' : 'error'); }
  catch (e) { t.fail(e.message); }
};
window.supabaseBackup = async () => {
  const t = toast('Backing up to Supabase…', 'loading');
  try { const r = await api.post('/supabase/backup'); t.done(`Backed up ${r.total} record(s) to workspace “${r.workspace}”${r.errors?.length ? ` · ${r.errors.length} error(s)` : ''}`); }
  catch (e) { t.fail(e.message); }
};
window.supabaseRestore = async () => {
  if (!confirm('Restore missing records from Supabase into this local database? Existing rows are kept (non-destructive).')) return;
  const t = toast('Restoring from Supabase…', 'loading');
  try { const r = await api.post('/supabase/restore'); t.done(`Restored ${r.total} record(s)`); }
  catch (e) { t.fail(e.message); }
};
window.supabaseSchema = () => { window.open('/supabase-schema.sql', '_blank'); };

// ---- Settings -------------------------------------------------------------
// Settings is fully schema-driven — the form is generated from /settings/schema,
// so every owner-configurable behavior lives in one declarative place (and each
// SaaS tenant later just stores their own values against the same schema).
views.settings = async () => {
  const [schema, s] = await Promise.all([api.get('/settings/schema'), api.get('/settings')]);
  const field = (f) => {
    const v = s[f.key] ?? '';
    const help = f.help ? `<p class="hint" style="margin:-6px 0 10px">${esc(f.help)}</p>` : '';
    // .env-only fields (e.g. Supabase secrets): never editable here, never saved
    // to the DB. Show a read-only status (set / not set) sourced from .env.
    if (f.envOnly) {
      const set = v !== '' && v != null;
      const status = set
        ? '<span class="badge published">✓ set via .env</span>'
        : `<span class="badge failed">not set</span>`;
      return `<label class="field"><span>${esc(f.label)} <span class="badge" style="font-size:9px">.env only</span></span>
        <div style="padding:8px 0">${status} <span class="muted" style="font-size:12px">${set ? (f.secret ? 'configured (hidden)' : esc(v)) : `add <code>${esc(f.env || '')}</code> to your .env file`}</span></div></label>${help}`;
    }
    let input;
    if (f.type === 'select' || f.type === 'toggle') {
      const opts = f.type === 'toggle' ? [['true', 'On'], ['false', 'Off']] : f.options;
      input = `<select data-k="${f.key}">${opts.map((o) => `<option value="${o[0]}" ${String(v) === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea data-k="${f.key}">${esc(v)}</textarea>`;
    } else {
      const t = f.type === 'number' ? 'number' : 'text';
      input = `<input data-k="${f.key}"${f.secret ? ' data-secret="1"' : ''} type="${t}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}"/>`;
    }
    const scope = f.scope === 'shared'
      ? ' <span class="badge" style="font-size:9px;background:var(--accent-soft);color:var(--accent)" title="Shared across all tenants (super admin)">🌐 shared</span>'
      : (currentUser && !currentUser.isSuperAdmin ? ' <span class="badge" style="font-size:9px" title="Specific to your workspace">your site</span>' : '');
    // Where the live value comes from — makes the dashboard-vs-.env precedence obvious.
    const src = f.source === 'dashboard'
      ? ' <span class="badge" style="font-size:9px;background:rgba(52,211,153,.15);color:#34d399" title="Value saved here in the dashboard. This OVERRIDES any .env value.">saved here</span>'
      : f.source === 'env'
        ? ' <span class="badge" style="font-size:9px;background:rgba(79,140,255,.15);color:var(--accent)" title="Value is coming from your .env file (no dashboard value saved). Saving here would override it.">from .env</span>'
        : '';
    return `<label class="field"><span>${esc(f.label)}${scope}${src}</span>${input}</label>${help}`;
  };
  const groupCard = (g) => `<div class="card"><h3>${esc(g.group)}</h3>
    ${g.help ? `<p class="hint">${esc(g.help)}</p>` : ''}
    ${g.fields.map(field).join('')}
    ${(g.actions || []).map((a) => `<button class="btn sm secondary" onclick="${a.fn}('${esc(a.arg || '')}')">${esc(a.label)}</button>`).join(' ')}
  </div>`;
  const envCount = schema.reduce((n, g) => n + g.fields.filter((f) => f.source === 'env').length, 0);
  $('#view').innerHTML = `
    <div class="callout" style="background:var(--accent-soft);border-color:var(--accent);margin-bottom:14px"><span class="ico">ℹ️</span>
      <div><b>Where settings come from:</b> the order of priority is <b>this Dashboard → .env → default</b>.
      A value <span class="badge" style="font-size:9px;background:rgba(52,211,153,.15);color:#34d399">saved here</span> in the dashboard <b>overrides</b> the same key in <code>.env</code>.
      A value tagged <span class="badge" style="font-size:9px;background:rgba(79,140,255,.15);color:var(--accent)">from .env</span> is being used because nothing is saved here for it.
      ${envCount ? `Right now <b>${envCount}</b> setting(s) are coming from .env.` : 'Right now everything is configured here in the dashboard.'}
      <span class="muted">(.env changes need a server restart. The Supabase credentials are intentionally .env-only.)</span></div></div>
    <div class="toolbar"><p class="muted" style="margin:0">Every behavior below is owner-controlled — nothing is hard-coded. <b>${schema.reduce((n, g) => n + g.fields.length, 0)}</b> settings.</p>
      <div class="spacer"></div><button class="btn" onclick="saveSettings()">💾 Save all settings</button></div>
    <div class="grid cols-2">${schema.map(groupCard).join('')}</div>
    <div style="margin-top:16px"><button class="btn" onclick="saveSettings()">💾 Save all settings</button></div>`;
};
window.saveSettings = async () => {
  const body = {};
  $$('[data-k]').forEach((el) => {
    // Don't resend an untouched secret (still showing the • mask) — leaves it intact.
    if (el.dataset.secret && /[••*]/.test(el.value)) return;
    body[el.dataset.k] = el.value;
  });
  await api.post('/settings', body);
  toast('Settings saved','success'); refreshHeader();
};

// ---- Logs -----------------------------------------------------------------
views.logs = async () => {
  const logs = await api.get('/logs?limit=200');
  $('#view').innerHTML = `<div class="card"><div class="section-head"><h2>Activity log</h2><button class="btn sm secondary" onclick="views.logs()">Refresh</button></div>
    <table><thead><tr><th>Time</th><th>Level</th><th>Area</th><th>Message</th></tr></thead><tbody>
    ${logs.map((l) => `<tr><td class="muted" style="font-size:12px;white-space:nowrap">${esc(l.created_at)}</td><td>${badge(l.level==='error'?'failed':l.level==='warn'?'pending_review':'approved')}</td><td>${esc(l.area)}</td><td>${esc(l.message)}</td></tr>`).join('')}
    </tbody></table></div>`;
};

// ---- Header / automation toggle ------------------------------------------
async function refreshHeader() {
  try {
    const s = await api.get('/status');
    const c = s.connections;
    $('#connDots').innerHTML = `
      <span class="dot ${c.wordpress?'on':''}" title="WordPress"></span>
      <span class="dot ${c.ahrefs?'on':''}" title="Ahrefs"></span>
      <span class="dot ${c.ai?'on':''}" title="AI"></span>
      <span class="dot ${c.gsc?'on':''}" title="Search Console"></span>`;
    $('#automationToggle').checked = s.automation_enabled;
    $('#automationLabel').textContent = s.automation_enabled ? 'Automation on' : 'Automation off';
  } catch { /* ignore */ }
}
$('#automationToggle').onchange = async (e) => {
  await api.post('/automation/toggle', { enabled: e.target.checked });
  toast(e.target.checked ? 'Automation enabled' : 'Automation paused', e.target.checked ? 'success' : '');
  refreshHeader();
};
window.runNow = async () => {
  const t = toast('Running one pass — replenish, generate, publish, optimise…', 'loading');
  await withBtn($('#runNowBtn'), async () => {
    try {
      const r = await api.post('/automation/run-now');
      if (r.skipped) { t.done(r.skipped, 'info'); return; }
      const parts = [];
      if (r.replenished) parts.push(`+${r.replenished} ideas`);
      parts.push(`+${r.generated} drafts`, `+${r.published} published`);
      if (r.scheduled) parts.push(`+${r.scheduled} scheduled`);
      t.done(`Pipeline done — ${parts.join(', ')}.`);
      if (['dashboard', 'articles', 'autopilot'].includes(current)) navigate(current);
    } catch (e) { t.fail(e.message); }
  });
};
$('#runNowBtn').onclick = runNow;
window.navigate = navigate;

// ---- Theme (light / dark) -------------------------------------------------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('wpap-theme', theme);
  $('#themeToggle').textContent = theme === 'light' ? '☀️' : '🌙';
}
$('#themeToggle').onclick = () =>
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
applyTheme(localStorage.getItem('wpap-theme') || 'dark');

// ---- Account chip ---------------------------------------------------------
let currentUser = null;
async function loadAccount() {
  const el = $('#acct'); if (!el) return;
  try {
    const me = await api.get('/auth/me');
    currentUser = me.user;
    if (!me.user) { el.innerHTML = ''; return; }
    const initial = (me.user.name || me.user.email || '?').trim().charAt(0).toUpperCase();
    const roleLabel = me.user.isSuperAdmin ? 'super admin' : 'owner';
    el.innerHTML = `<div class="menu-wrap">
      <div class="chip" onclick="toggleMenu(this)"><span class="av">${esc(initial)}</span><span>${esc((me.user.name || me.user.email).split('@')[0])}</span> ▾</div>
      <div class="menu" style="display:none">
        <div class="who">${esc(me.user.email)}<br><span class="role">${roleLabel}</span> · workspace <b>${esc(me.user.workspace_id)}</b></div>
        ${me.user.isSuperAdmin ? '<button onclick="closeMenus();navigate(\'settings\')">⚙ Shared settings</button>' : ''}
        <button onclick="closeMenus();logout()">↩ Sign out</button>
      </div></div>`;
  } catch { el.innerHTML = ''; }
}
window.logout = async () => { try { await api.post('/auth/logout'); } catch { /* ignore */ } location.href = '/'; };

// ---- Boot -----------------------------------------------------------------
// Support deep-link hashes like "/#searchconsole" (used by the GSC OAuth return).
const hashView = location.hash.replace('#', '');
loadAccount();
refreshHeader();
navigate(titles[hashView] ? hashView : 'workflow');
setInterval(refreshHeader, 20000);
