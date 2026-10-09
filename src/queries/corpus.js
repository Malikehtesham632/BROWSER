import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function normalize(q) { return String(q || '').replace(/\s+/g, ' ').trim(); }
function idFor(q) { return crypto.createHash('sha256').update(q.toLowerCase()).digest('hex').slice(0, 16); }

export class QueryCorpus {
  constructor(file) { this.file = file; this.rows = new Map(); this.ready = false; }
  async init() {
    if (this.ready) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const rows = JSON.parse(raw);
      for (const row of rows) if (row?.query) this.rows.set(idFor(row.query), row);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.ready = true;
  }
  async addMany(items, meta = {}) {
    await this.init(); let added = 0;
    for (const item of items) {
      const query = normalize(typeof item === 'string' ? item : item?.query);
      if (!query || query.length > 300) continue;
      const id = idFor(query);
      if (this.rows.has(id)) continue;
      this.rows.set(id, { id, query, category: item?.category || meta.category || 'uncategorized', intent: item?.intent || meta.intent || 'informational', source: item?.source || meta.source || 'user', createdAt: new Date().toISOString() });
      added++;
    }
    await this.flush(); return added;
  }
  list({category, intent, limit} = {}) {
    let rows = [...this.rows.values()];
    if (category) rows = rows.filter(x => x.category === category);
    if (intent) rows = rows.filter(x => x.intent === intent);
    return limit ? rows.slice(0, limit) : rows;
  }
  stats() { const rows = [...this.rows.values()]; return { queries: rows.length, categories: new Set(rows.map(x => x.category)).size, intents: new Set(rows.map(x => x.intent)).size }; }
  async flush() { await fs.writeFile(`${this.file}.tmp`, JSON.stringify([...this.rows.values()], null, 2), 'utf8'); await fs.rename(`${this.file}.tmp`, this.file); }
}
