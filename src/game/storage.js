const KEY = 'neon-janken-v1';

const DEFAULTS = {
  settings: { bgm: true, sfx: true, vibe: true, quality: 'auto' },
  stats: {
    matches: 0,
    wins: 0,
    bestCombo: 0,
    streak: 0,
    bestStreak: 0,
    cleared: { easy: false, normal: false, hard: false },
    bestRank: {},
    lastDifficulty: 'normal',
  },
};

// Persists settings and records in localStorage. Every access is guarded:
// private mode or blocked storage simply falls back to in-memory defaults.
export class Storage {
  constructor() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    this.settings = { ...DEFAULTS.settings, ...(saved.settings || {}) };
    this.stats = {
      ...DEFAULTS.stats,
      ...(saved.stats || {}),
      cleared: { ...DEFAULTS.stats.cleared, ...(saved.stats?.cleared || {}) },
      bestRank: { ...(saved.stats?.bestRank || {}) },
    };
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ settings: this.settings, stats: this.stats }));
    } catch {
      /* storage unavailable */
    }
  }
}

export const RANK_ORDER = ['C', 'B', 'A', 'S'];
