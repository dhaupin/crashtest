// S1.2 - interleaved additive lagged Fibonacci RNG (Node internal-style).
// Deterministic: same seed -> same sequence on any platform (PRD principle 3).
// No deps; pure `Math.imul` math. Not crypto - campaign fuzz never needs
// unpredictability, it needs reproducibility.

export class Rng {
  constructor(seed = 0xC0FFEE) {
    this.state = (seed >>> 0) || 1;
    this.seed = this.state;
  }

  /** 32-bit xorshift*; returns uint32. */
  next() {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return (this.state * 0x2c1b3c6d) >>> 0;
  }

  /** float in [0,1) */
  float() {
    return this.next() / 0x100000000;
  }

  /** integer in [min, max] inclusive */
  int(min, max) {
    return min + (this.next() % (max - min + 1));
  }

  pick(list) {
    return list[this.next() % list.length];
  }

  /** Fisher-Yates shuffle (returns a copy; deterministic). */
  shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.next() % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  boolean() {
    return (this.next() & 1) === 1;
  }
}

/** Compound seed helper: derive per-attack sub-seeds (name -> uint mix). */
export function mixSpreadSeeds(baseSeed, name) {
  let h = (baseSeed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h ^ name.charCodeAt(i), 0x01000193)) >>> 0;
  }
  return h;
}
