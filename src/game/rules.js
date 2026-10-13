export const HANDS = ['rock', 'scissors', 'paper'];

// What each hand beats.
export const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
// What beats each hand.
export const COUNTER = { rock: 'paper', scissors: 'rock', paper: 'scissors' };

export const HAND_INFO = {
  rock: { en: 'ROCK', jp: 'グー', attack: 'CRUSH', attackJp: 'クラッシュ' },
  scissors: { en: 'SCISSORS', jp: 'チョキ', attack: 'SLASH', attackJp: 'スラッシュ' },
  paper: { en: 'PAPER', jp: 'パー', attack: 'WRAP', attackJp: 'ラップ' },
};

export const RULES = {
  maxHp: 100,
  baseDamage: 22,
  comboBonus: 8,
  maxComboBonus: 24,
  critChance: 0.12,
  critMultiplier: 1.5,
};

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'EASY',
    name: 'ROOKIE-07',
    jp: '見習いロボ',
    desc: 'クセの強いルーキー。よく見れば勝てる！',
    stars: 1,
  },
  normal: {
    id: 'normal',
    label: 'NORMAL',
    name: 'VANGUARD',
    jp: '標準戦闘ロボ',
    desc: '完全ランダムの実力派。運と勢いで押し切れ！',
    stars: 2,
  },
  hard: {
    id: 'hard',
    label: 'HARD',
    name: 'OMEGA-X',
    jp: '学習型AI',
    desc: 'あなたのクセを学習して読んでくる最強AI。',
    stars: 3,
  },
};

// 1 = a wins, -1 = b wins, 0 = draw.
export function judge(a, b) {
  if (a === b) return 0;
  return BEATS[a] === b ? 1 : -1;
}

export function damageFor(combo, crit) {
  const bonus = Math.min(RULES.maxComboBonus, RULES.comboBonus * Math.max(0, combo - 1));
  const base = RULES.baseDamage + bonus;
  return Math.round(crit ? base * RULES.critMultiplier : base);
}
