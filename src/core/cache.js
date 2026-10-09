export class TTLCache {
  constructor({ max = 500, ttlMs = 900000, now = Date.now } = {}) {
    this.max = max; this.ttlMs = ttlMs; this.now = now; this.map = new Map();
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires <= this.now()) { this.map.delete(key); return undefined; }
    this.map.delete(key); this.map.set(key, e); return e.value;
  }
  set(key, value, ttlMs = this.ttlMs) {
    this.map.delete(key); this.map.set(key, {value, expires: this.now()+ttlMs});
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}
