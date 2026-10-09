export class CircuitBreaker {
  constructor({ threshold=3, cooldownMs=60000, now=Date.now }={}) {
    this.threshold=threshold; this.cooldownMs=cooldownMs; this.now=now; this.state=new Map();
  }
  #get(name) {
    if (!this.state.has(name)) this.state.set(name,{failures:0,openUntil:0});
    return this.state.get(name);
  }
  isOpen(name) {
    const s=this.#get(name);
    if (s.openUntil > this.now()) return true;
    if (s.openUntil) { s.openUntil=0; s.failures=this.threshold-1; }
    return false;
  }
  success(name){ const s=this.#get(name); s.failures=0; s.openUntil=0; }
  failure(name){ const s=this.#get(name); if(++s.failures>=this.threshold)s.openUntil=this.now()+this.cooldownMs; }
}
