import { HANDS, BEATS, COUNTER } from './rules.js';
import { pick, chance } from '../core/math.js';

// EASY: a rookie with an obvious favorite hand and a habit of repeating itself.
class RookieAI {
  constructor() {
    this.favorite = pick(HANDS);
    this.last = null;
  }
  next() {
    if (this.last && chance(0.22)) return this.last;
    if (chance(0.48)) return this.favorite;
    return pick(HANDS);
  }
  observe(player, cpu) {
    this.last = cpu;
  }
}

// NORMAL: honest randomness (but never four of the same hand in a row).
class RandomAI {
  constructor() {
    this.recent = [];
  }
  next() {
    let h = pick(HANDS);
    const r = this.recent;
    if (r.length >= 3 && r.slice(-3).every((x) => x === h)) h = pick(HANDS.filter((x) => x !== h));
    return h;
  }
  observe(player, cpu) {
    this.recent.push(cpu);
    if (this.recent.length > 6) this.recent.shift();
  }
}

// HARD: an ensemble of pattern predictors that learns the player's habits.
// Each predictor guesses the player's next hand; the best-scoring one is
// trusted most of the time and the AI throws the counter to its guess.
class AdaptiveAI {
  constructor() {
    this.p = []; // player history
    this.c = []; // cpu history
    this.o = []; // outcomes from the player's view: 1 win, 0 draw, -1 loss
    this.tables = {
      freq: {},
      m1: {},
      m2: {},
      mo: {},
      react: {},
    };
    this.predictors = {
      freq: () => this._argmax(this.tables.freq, ''),
      markov1: () => (this.p.length >= 1 ? this._argmax(this.tables.m1, this._at(this.p, 1)) : null),
      markov2: () => (this.p.length >= 2 ? this._argmax(this.tables.m2, this._at(this.p, 2) + this._at(this.p, 1)) : null),
      outcome: () => (this.p.length >= 1 ? this._argmax(this.tables.mo, this._at(this.p, 1) + this._at(this.o, 1)) : null),
      react: () => (this.c.length >= 1 ? this._argmax(this.tables.react, this._at(this.c, 1)) : null),
      repeat: () => (this.p.length >= 1 ? this._at(this.p, 1) : null),
      cycle: () => (this.p.length >= 1 ? COUNTER[this._at(this.p, 1)] : null),
      beatLastCpu: () => (this.c.length >= 1 ? COUNTER[this._at(this.c, 1)] : null),
    };
    this.scores = Object.fromEntries(Object.keys(this.predictors).map((k) => [k, 0]));
    this.pending = null;
  }

  _at(arr, back) {
    return String(arr[arr.length - back]);
  }

  _bump(table, key, hand) {
    const row = (table[key] = table[key] || { rock: 0, scissors: 0, paper: 0 });
    for (const h of HANDS) row[h] *= 0.9;
    row[hand] += 1;
  }

  _argmax(table, key) {
    const row = table[key];
    if (!row) return null;
    let best = null;
    let bestV = 0.2;
    for (const h of HANDS) {
      if (row[h] > bestV) {
        best = h;
        bestV = row[h];
      }
    }
    return best;
  }

  next() {
    const guesses = {};
    for (const [k, fn] of Object.entries(this.predictors)) guesses[k] = fn();
    this.pending = guesses;
    if (this.p.length < 3) return pick(HANDS);
    let bestK = null;
    let bestS = 0.6;
    for (const k of Object.keys(guesses)) {
      if (guesses[k] && this.scores[k] > bestS) {
        bestK = k;
        bestS = this.scores[k];
      }
    }
    if (bestK && chance(0.8)) return COUNTER[guesses[bestK]];
    return pick(HANDS);
  }

  observe(player, cpu, outcome) {
    if (this.pending) {
      for (const [k, g] of Object.entries(this.pending)) {
        if (!g) continue;
        this.scores[k] = this.scores[k] * 0.82 + (g === player ? 1 : BEATS[g] === player ? -0.6 : -0.2);
      }
    }
    const t = this.tables;
    this._bump(t.freq, '', player);
    if (this.p.length >= 1) {
      this._bump(t.m1, this._at(this.p, 1), player);
      this._bump(t.mo, this._at(this.p, 1) + this._at(this.o, 1), player);
    }
    if (this.p.length >= 2) this._bump(t.m2, this._at(this.p, 2) + this._at(this.p, 1), player);
    if (this.c.length >= 1) this._bump(t.react, this._at(this.c, 1), player);
    this.p.push(player);
    this.c.push(cpu);
    this.o.push(outcome);
    this.pending = null;
  }
}

export function createAI(difficulty) {
  if (difficulty === 'easy') return new RookieAI();
  if (difficulty === 'hard') return new AdaptiveAI();
  return new RandomAI();
}
