import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function keyFor(model, system, user) {
  return crypto.createHash('sha256').update(JSON.stringify({ model, system, user })).digest('hex');
}

export class AICache {
  constructor(file, { ttlMs = 7 * 24 * 60 * 60 * 1000, maxEntries = 2000 } = {}) {
    this.file = file;
    this.ttlMs = Math.max(0, Number(ttlMs) || 0);
    this.maxEntries = Math.max(1, Number(maxEntries) || 2000);
    this.rows = new Map();
    this.ready = false;
  }
  async init() {
    if (this.ready) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8'));
      for (const row of Array.isArray(raw) ? raw : []) if (row?.key && row?.createdAt) this.rows.set(row.key, row);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.prune(false);
    this.ready = true;
  }
  async get(model, system, user) {
    await this.init();
    const key = keyFor(model, system, user);
    const row = this.rows.get(key);
    if (!row) return null;
    if (this.ttlMs && Date.now() - Date.parse(row.createdAt) > this.ttlMs) {
      this.rows.delete(key); await this.flush(); return null;
    }
    row.lastUsedAt = new Date().toISOString();
    return row.value;
  }
  async set(model, system, user, value) {
    await this.init();
    const key = keyFor(model, system, user);
    this.rows.set(key, { key, model, value, createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() });
    this.prune(false);
    await this.flush();
    return value;
  }
  prune(flush = true) {
    const now = Date.now();
    if (this.ttlMs) for (const [key, row] of this.rows) if (now - Date.parse(row.createdAt) > this.ttlMs) this.rows.delete(key);
    if (this.rows.size > this.maxEntries) {
      const rows = [...this.rows.values()].sort((a,b) => Date.parse(a.lastUsedAt || a.createdAt) - Date.parse(b.lastUsedAt || b.createdAt));
      for (const row of rows.slice(0, this.rows.size - this.maxEntries)) this.rows.delete(row.key);
    }
    if (flush) return this.flush();
  }
  stats() { return { entries: this.rows.size, file: this.file, ttlMs: this.ttlMs, maxEntries: this.maxEntries }; }
  async flush() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify([...this.rows.values()], null, 2), 'utf8');
    await fs.rename(`${this.file}.tmp`, this.file);
  }
}
