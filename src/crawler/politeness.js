const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PRUNE_ABOVE = 1000;

export class HostLimiter {
  constructor({ sleep = defaultSleep, now = Date.now } = {}) {
    this.sleep = sleep;
    this.now = now;
    this.nextSlot = new Map();
  }

  async wait(host, delayMs) {
    const now = this.now();
    if (this.nextSlot.size > PRUNE_ABOVE) {
      for (const [name, slot] of this.nextSlot) if (slot <= now) this.nextSlot.delete(name);
    }
    const start = Math.max(now, this.nextSlot.get(host) || 0);
    this.nextSlot.set(host, start + Math.max(0, delayMs));
    if (start > now) await this.sleep(start - now);
  }
}
