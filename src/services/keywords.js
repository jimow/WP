// Keyword research: pull ideas from Ahrefs for a seed, or accept manual entries,
// and store them de-duplicated in the keywords table.
import db from '../db.js';
import ahrefs from '../clients/ahrefs.js';
import cfg from '../config.js';
import log from '../log.js';

const upsert = db.prepare(`
  INSERT INTO keywords(keyword, volume, difficulty, cpc, intent, parent_topic, source)
  VALUES(@keyword, @volume, @difficulty, @cpc, @intent, @parent_topic, @source)
  ON CONFLICT(keyword) DO UPDATE SET
    volume=COALESCE(excluded.volume, keywords.volume),
    difficulty=COALESCE(excluded.difficulty, keywords.difficulty),
    cpc=COALESCE(excluded.cpc, keywords.cpc),
    intent=COALESCE(excluded.intent, keywords.intent),
    parent_topic=COALESCE(excluded.parent_topic, keywords.parent_topic)
`);

export async function researchSeed(seed, { limit = 50 } = {}) {
  const country = cfg.get('target_country') || 'us';
  const rows = await ahrefs.keywordIdeas(seed, country, limit);
  const tx = db.transaction((items) => {
    for (const r of items) {
      upsert.run({
        keyword: r.keyword.toLowerCase().trim(),
        volume: r.volume ?? null,
        difficulty: r.difficulty ?? null,
        cpc: r.cpc ?? null,
        intent: r.intent ?? null,
        parent_topic: r.parent_topic ?? null,
        source: 'ahrefs',
      });
    }
  });
  tx(rows);
  log.info('keywords', `Ahrefs returned ${rows.length} ideas for "${seed}"`);
  return rows.length;
}

export function addManual(keyword, { volume, difficulty, intent } = {}) {
  upsert.run({
    keyword: keyword.toLowerCase().trim(),
    volume: volume ?? null,
    difficulty: difficulty ?? null,
    cpc: null,
    intent: intent ?? null,
    parent_topic: null,
    source: 'manual',
  });
}

export function list({ status, limit = 200 } = {}) {
  if (status) {
    return db.prepare('SELECT * FROM keywords WHERE status = ? ORDER BY volume DESC NULLS LAST LIMIT ?').all(status, limit);
  }
  return db.prepare('SELECT * FROM keywords ORDER BY volume DESC NULLS LAST LIMIT ?').all(limit);
}

export function setStatus(id, status) {
  db.prepare('UPDATE keywords SET status = ? WHERE id = ?').run(status, id);
}

export function remove(id) {
  db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
}

export default { researchSeed, addManual, list, setStatus, remove };
