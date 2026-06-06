// Turns raw Search Console data into a digest the dashboard can show, plus
// AI-generated "what we can do about it" recommendations and an easy path to
// turn "striking distance" queries (ranking ~8-20) into new article ideas.
import gsc from '../clients/gsc.js';
import ai from '../clients/ai.js';
import cfg from '../config.js';
import articles from './articles.js';
import log from '../log.js';

function range(days = 28) {
  // GSC data lags ~2 days; end the window there.
  const end = new Date();
  end.setDate(end.getDate() - 2);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

export async function overview(days = 28) {
  const { startDate, endDate } = range(days);
  const [byDate, byQuery, byPage] = await Promise.all([
    gsc.query({ startDate, endDate, dimensions: ['date'], rowLimit: 1000 }),
    gsc.query({ startDate, endDate, dimensions: ['query'], rowLimit: 200 }),
    gsc.query({ startDate, endDate, dimensions: ['page'], rowLimit: 100 }),
  ]);

  const t = byDate.reduce(
    (a, r) => {
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.posSum += r.position * r.impressions;
      return a;
    },
    { clicks: 0, impressions: 0, posSum: 0 }
  );
  const totals = {
    clicks: t.clicks,
    impressions: t.impressions,
    ctr: t.impressions ? t.clicks / t.impressions : 0,
    position: t.impressions ? t.posSum / t.impressions : 0,
  };

  // "Striking distance": page 1-2 positions with real impressions — quick wins.
  const striking = byQuery
    .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 10)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25);

  return {
    range: { startDate, endDate, days },
    totals,
    trend: byDate.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
    topQueries: byQuery.slice(0, 25).map((r) => ({ query: r.keys[0], ...metrics(r) })),
    topPages: byPage.slice(0, 25).map((r) => ({ page: r.keys[0], ...metrics(r) })),
    striking: striking.map((r) => ({ query: r.keys[0], ...metrics(r) })),
  };
}

function metrics(r) {
  return { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: Math.round(r.position * 10) / 10 };
}

export async function recommendations(days = 28) {
  const o = await overview(days);
  const topic = cfg.get('site_topic') || cfg.get('brand_name') || 'the website';
  const fmtRows = (rows, k) => rows.slice(0, 15).map((r) => `- "${r[k]}": ${r.clicks} clicks, ${r.impressions} impr, pos ${r.position}, CTR ${(r.ctr * 100).toFixed(1)}%`).join('\n');

  let advice = [];
  try {
    const out = await ai.json({
      system: `You are a senior SEO consultant analysing Google Search Console data for ${topic}. Give concrete, prioritised, actionable advice — not generic tips.`,
      prompt: `Window: ${o.range.startDate} to ${o.range.endDate}.
Totals: ${o.totals.clicks} clicks, ${o.totals.impressions} impressions, CTR ${(o.totals.ctr * 100).toFixed(1)}%, avg position ${o.totals.position.toFixed(1)}.

Top queries:
${fmtRows(o.topQueries, 'query')}

Striking-distance queries (ranking 8-20, biggest quick wins):
${fmtRows(o.striking, 'query')}

Top pages:
${fmtRows(o.topPages, 'page')}

Return JSON:
{"recommendations":[{"title":"short action","detail":"what to do and why, referencing the data","priority":"high|medium|low","effort":"quick|medium|large"}]}`,
      maxTokens: 2000,
    });
    advice = out.recommendations || [];
  } catch (e) {
    log.warn('insights', `AI recommendations failed: ${e.message}`);
  }
  return { ...o, advice };
}

// Turn selected striking-distance queries into article ideas in the queue.
export function striveToIdeas(queries = []) {
  let added = 0;
  for (const q of queries) {
    if (!q) continue;
    articles.addIdea(q, 'spoke');
    added++;
  }
  log.info('insights', `Added ${added} striking-distance queries as article ideas`);
  return added;
}

export default { overview, recommendations, striveToIdeas };
