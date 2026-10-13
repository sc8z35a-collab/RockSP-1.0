import * as THREE from 'three';
import { HAND_INFO, DIFFICULTIES, RULES, judge, damageFor } from './rules.js';
import { createAI } from './ai.js';
import { RANK_ORDER } from './storage.js';
import { Ease } from '../core/math.js';
import { LAYOUT } from '../world/world.js';

const CANCELLED = Symbol('cancelled');
const POSES = ['rock', 'scissors', 'paper'];
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Match flow: title showcase, intro, "じゃん・けん・ぽん", attacks, K.O. and results.
// Every async flow is tied to a session id; starting a new flow invalidates the
// old one so quitting mid-animation can never leak state into the next match.
export class Game {
  constructor(ctx) {
    this.world = ctx.world;
    this.fx = ctx.fx;
    this.rig = ctx.rig;
    this.ui = ctx.ui;
    this.audio = ctx.audio;
    this.clock = ctx.clock;
    this.tweens = ctx.tweens;
    this.storage = ctx.storage;
    this.platform = ctx.platform;
    this.state = 'boot';
    this.session = 0;
    this.paused = false;
    this.match = null;
    this.onCancel = (e) => {
      if (e !== CANCELLED) console.error(e);
    };
    this._wireUI();
  }

  get hands() {
    return this.world.hands;
  }

  // ---------- Infrastructure ----------

  newSession() {
    this.session++;
    this.clock.cancelWaits();
    this.tweens.killAll();
    this.clock.resetEffects();
    return this.session;
  }

  async wait(seconds, sid) {
    await this.clock.wait(seconds);
    if (sid !== this.session) throw CANCELLED;
  }

  haptic(pattern) {
    if (!this.storage.settings.vibe || !navigator.vibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* not supported */
    }
  }

  resetHands({ pose = 'rock', instant = false } = {}) {
    for (const h of this.hands) {
      h.power = 1;
      h.glow = 1;
      h.hitFlash = 0;
      h.glowFlicker = 0;
      h.idle = 1;
      for (const k in h.kick) h.kick[k].snap(0);
      const a = h.anim;
      if (instant) Object.assign(a, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1 });
      else this.tweens.to(a, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1 }, 0.45, { ease: Ease.outCubic });
      h.setPose(pose, { instant });
    }
  }

  screenPos(worldPos) {
    _v.copy(worldPos).project(this.world.camera);
    return { x: (_v.x * 0.5 + 0.5) * window.innerWidth, y: (-_v.y * 0.5 + 0.5) * window.innerHeight };
  }

  // ---------- Title ----------

  enterTitle() {
    const sid = this.newSession();
    this.state = 'title';
    this.paused = false;
    this.clock.timeScale = 1;
    this.match = null;
    this.fx.clear();
    this.fx.dangerTarget = 0;
    this.fx.desaturateTarget = 0;
    this.ui.clearCallouts();
    this.ui.setRecords(this.storage.stats);
    this.ui.selectDifficulty(this.storage.stats.lastDifficulty || 'normal');
    this.ui.showTitle({ started: this.audio.ready });
    this.ui.showIosHint(this.audio.ready && this.platform.showIosHint);
    if (this.audio.ready) this.audio.music?.setMode('title');
    this.audio.tension(0);
    this.resetHands({ pose: 'relaxed' });
    this.tweens.to(this.rig, { orbit: 1 }, 1.2, { ease: Ease.inOutCubic });
    this.rig.shot('idle', 1.0);
    this.world.arena.energy = 0;
    this._titleShowcase(sid).catch(this.onCancel);
  }

  async _titleShowcase(sid) {
    let i = 0;
    await this.wait(1.2, sid);
    for (;;) {
      const a = POSES[i % 3];
      const b = POSES[(i + 1) % 3];
      this.hands[0].setPose(a, { stiffness: 300, damping: 24 });
      this.hands[1].setPose(b, { stiffness: 300, damping: 24 });
      i++;
      await this.wait(2.4, sid);
    }
  }

  tapStart() {
    if (this.state !== 'title' || this.ui.started) return;
    this.audio.unlock();
    this.applyAudioSettings();
    this.audio.music?.setMode('title');
    this.audio.start();
    this.platform.enterFullscreen();
    this.ui.showMenu();
    this.ui.showIosHint(this.platform.showIosHint);
    this.haptic(15);
  }

  applyAudioSettings() {
    this.audio.setBgm(this.storage.settings.bgm);
    this.audio.setSfx(this.storage.settings.sfx);
  }

  // ---------- Match ----------

  async startMatch(difficulty) {
    const sid = this.newSession();
    this.state = 'intro';
    this.paused = false;
    this.clock.timeScale = 1;
    this.audio.unlock();
    this.applyAudioSettings();
    this.platform.enterFullscreen();
    this.platform.keepAwake(true);
    this.storage.stats.lastDifficulty = difficulty;
    this.storage.save();

    const D = DIFFICULTIES[difficulty];
    this.match = {
      difficulty,
      ai: createAI(difficulty),
      hp: [RULES.maxHp, RULES.maxHp],
      round: 1,
      combo: [0, 0],
      maxCombo: [0, 0],
      wins: 0,
      losses: 0,
      draws: 0,
      throws: 0,
      crits: 0,
      usage: { rock: 0, scissors: 0, paper: 0 },
      aiko: false,
      cpuPick: null,
    };

    this.fx.clear();
    this.fx.dangerTarget = 0;
    this.fx.desaturateTarget = 0;
    this.ui.clearCallouts();
    this.ui.showHud('YOU', D.name);
    this.ui.setRound(1);
    this.audio.music?.setMode('battle');
    this.audio.start();

    // Camera sweeps down from the rafters while both arms slide in.
    this.tweens.to(this.rig, { orbit: 0 }, 1.3, { ease: Ease.inOutCubic });
    this.rig.shot('intro', 0);
    this.rig.shot('idle', 1.7, Ease.inOutCubic);
    this.resetHands({ pose: 'relaxed', instant: true });
    for (const h of this.hands) {
      h.anim.x = -2.6;
      h.anim.y = -0.4;
      this.tweens.to(h.anim, { x: 0, y: 0 }, 1.25, { ease: Ease.outBack, delay: 0.25 });
    }
    this.world.arena.energy = 0.4;

    await this.wait(0.45, sid);
    this.ui.versus('YOU', D.name, D.jp);
    this.audio.whoosh(0.3, 0.35);
    await this.wait(0.4, sid);
    this.audio.clash();
    this.rig.shake(0.2);
    await this.wait(1.15, sid);
    for (const h of this.hands) h.setPose('rock', { stiffness: 420 });
    this.ui.banner('ROUND 1');
    this.audio.round();
    await this.wait(1.15, sid);
    this.ui.banner('FIGHT!', 'fight', 1100);
    this.audio.fight();
    this.fx.charge(0, 2);
    this.fx.charge(1, 2);
    this.world.arena.pulse = 1;
    this.rig.shake(0.25);
    this.haptic(30);
    await this.wait(0.85, sid);
    this.beginRound(sid);
  }

  beginRound(sid) {
    if (sid !== this.session) return;
    const m = this.match;
    this.state = 'choose';
    m.cpuPick = m.ai.next();
    this.ui.showChoices();
    this.ui.setPrompt(m.aiko ? 'あいこで…　もう一度えらんでね' : 'じゃんけん…　手をえらんでね');
    for (const h of this.hands) {
      h.setPose('rock', { stiffness: 380 });
      h.idle = 1;
      h.glow = 1;
    }
    this.rig.shot('idle', 0.7);
    this.audio.tension(0);
  }

  choose(hand) {
    if (this.state !== 'choose' || this.paused) return;
    this.state = 'throw';
    this.haptic(12);
    this.audio.select();
    this.ui.lockChoice(hand);
    this.ui.setPrompt('');
    this.playRound(this.session, hand).catch(this.onCancel);
  }

  bob(side, power = 1) {
    const a = this.hands[side].anim;
    const tw = this.tweens;
    tw.to(a, { y: 0.22 * power, rz: 0.3 * power, x: -0.1 * power }, 0.13, {
      ease: Ease.outQuad,
      onComplete: () =>
        tw.to(a, { y: -0.07, rz: -0.08, x: 0.06 }, 0.14, {
          ease: Ease.inQuad,
          onComplete: () => tw.to(a, { y: 0, rz: 0, x: 0 }, 0.12, { ease: Ease.outQuad }),
        }),
    });
  }

  throwHand(side, shape) {
    const h = this.hands[side];
    h.setPose(shape, { stiffness: 950, damping: 44, stagger: 0.008 });
    h.idle = 0.15;
    h.glow = 2.2;
    this.tweens.to(h.anim, { x: LAYOUT.reach[shape], y: 0.06, rz: 0, rx: 0 }, 0.17, { ease: Ease.outQuart });
  }

  clashPoint(target) {
    this.hands[0].frontPoint(_v);
    this.hands[1].frontPoint(_v2);
    return target.copy(_v).add(_v2).multiplyScalar(0.5);
  }

  async playRound(sid, p) {
    const m = this.match;
    const c = m.cpuPick;
    const aiko = m.aiko;
    const outcome = judge(p, c);
    const winner = outcome === 1 ? 0 : outcome === -1 ? 1 : -1;
    const crit = winner >= 0 && Math.random() < RULES.critChance;
    const nextCombo = winner >= 0 ? m.combo[winner] + 1 : 0;
    const dmg = winner >= 0 ? damageFor(nextCombo, crit) : 0;
    const finisher = winner >= 0 && m.hp[1 - winner] - dmg <= 0;
    m.throws++;
    m.usage[p]++;

    await this.wait(0.2, sid);
    this.ui.hideChoices();

    const beats = aiko ? ['あいこで', 'しょ！'] : ['じゃん', 'けん', 'ぽん！'];
    const gap = aiko ? 0.4 : 0.38;
    this.audio.tension(0.55);
    this.world.arena.energy = 0.6;
    for (let i = 0; i < beats.length - 1; i++) {
      this.ui.callout(beats[i], 'chant', { duration: 650 });
      this.audio.chant(aiko ? 1 : i);
      this.fx.beat(i + 1);
      this.fx.charge(0);
      this.fx.charge(1);
      this.haptic(10);
      this.bob(0, 1 + i * 0.15);
      this.bob(1, 1 + i * 0.15);
      for (const h of this.hands) h.glow = 1.4 + i * 0.4;
      this.rig.shot(i === 0 && !aiko ? 'chant1' : 'chant2', gap * 0.9, Ease.outCubic);
      await this.wait(gap, sid);
    }

    // "ぽん！" — both hands throw.
    this.ui.callout(beats[beats.length - 1], 'chant final', { duration: 850 });
    this.audio.pon();
    this.audio.tension(0);
    this.fx.startTrail(0);
    this.fx.startTrail(1);
    this.throwHand(0, p);
    this.throwHand(1, c);
    this.rig.shot('clash', 0.18, Ease.outQuart);
    await this.wait(0.17, sid);

    const center = this.clashPoint(new THREE.Vector3());
    this.fx.clash(center, outcome === 0);
    this.audio.clash();
    this.fx.stopTrails();
    this.haptic([0, 30]);
    if (finisher) this.clock.slowMo(0.3, 0.35, 0.3);
    else this.clock.hitStop(0.085);
    m.ai.observe(p, c, outcome);
    await this.wait(0.12, sid);

    if (winner < 0) return this.resolveDraw(sid, center);
    return this.resolveHit(sid, winner, winner === 0 ? p : c, crit, dmg);
  }

  async resolveDraw(sid, center) {
    const m = this.match;
    m.draws++;
    m.aiko = true;
    this.fx.repel(center);
    this.audio.repel();
    this.audio.draw();
    for (const h of this.hands) {
      h.impulse({ x: -4.2, rz: 0.8, y: 0.6 });
      h.glow = 1;
      this.tweens.to(h.anim, { x: 0, y: 0 }, 0.5, { ease: Ease.outCubic });
    }
    this.ui.callout('あいこ！', 'result draw', { duration: 1100 });
    this.rig.shot('idle', 0.7);
    await this.wait(0.95, sid);
    this.beginRound(sid);
  }

  async resolveHit(sid, winner, winShape, crit, dmg) {
    const m = this.match;
    const loser = 1 - winner;
    const W = this.hands[winner];
    const L = this.hands[loser];
    const playerWon = winner === 0;

    m.combo[winner]++;
    m.combo[loser] = 0;
    m.maxCombo[winner] = Math.max(m.maxCombo[winner], m.combo[winner]);
    if (playerWon) m.wins++;
    else m.losses++;
    if (crit && playerWon) m.crits++;
    m.aiko = false;

    this.ui.callout(playerWon ? 'YOU WIN!' : 'YOU LOSE…', `result ${playerWon ? 'win' : 'lose'}`, { duration: 1300 });
    if (playerWon) this.audio.win();
    else this.audio.lose();
    this.rig.shot(loser === 0 ? 'focusP1' : 'focusP2', 0.45, Ease.outCubic);
    W.glow = 2.6;

    const attack = HAND_INFO[winShape].attack;
    const fromX = loser === 0 ? '30vw' : '-30vw';
    if (winShape === 'rock') {
      this.tweens.to(W.anim, { x: LAYOUT.reach.rock + 0.5 }, 0.09, { ease: Ease.inQuad });
      await this.wait(0.09, sid);
      this.fx.crush(loser, winner);
      this.audio.crush();
      L.impulse({ x: -7.5, y: 1.6, rz: 1.9 });
      this.clock.hitStop(0.07);
    } else if (winShape === 'scissors') {
      this.tweens.to(W.anim, { x: LAYOUT.reach.scissors + 0.35, rz: -0.25 }, 0.1, { ease: Ease.outQuad });
      W.impulse({ rz: -1.4 });
      this.fx.slash(loser, winner);
      this.audio.slash();
      await this.wait(0.08, sid);
      L.impulse({ x: -5.5, y: 0.8, rz: -1.6 });
    } else {
      this.tweens.to(W.anim, { x: LAYOUT.reach.paper + 0.35 }, 0.3, { ease: Ease.outCubic });
      this.fx.wrap(loser, winner);
      this.audio.wrap();
      L.glowFlicker = 0.7;
      await this.wait(0.72, sid);
      this.fx.wrapBurst(loser, winner);
      this.audio.wrapPop();
      L.impulse({ x: -6.5, y: 1.2, rz: 1.3 });
    }
    this.ui.callout(`${attack}!!`, 'attack', { duration: 950, from: fromX });
    L.hitFlash = 1.4;
    L.glowFlicker = Math.max(L.glowFlicker, 0.45);
    this.fx.hitSparks(loser, crit ? 1.6 : 1);
    this.haptic(crit ? [0, 60, 40, 60] : [0, 45]);
    if (crit) {
      this.ui.callout('CRITICAL!', 'crit', { duration: 1000 });
      this.audio.critical();
      this.fx.screenFlash(0.35, new THREE.Color(1, 0.8, 0.4));
    }

    // Apply damage.
    m.hp[loser] = Math.max(0, m.hp[loser] - dmg);
    this.ui.setHp(loser, m.hp[loser]);
    this.ui.shake();
    this.ui.setCombo(winner, m.combo[winner]);
    this.ui.setCombo(loser, 0);
    if (m.combo[winner] >= 2) this.audio.combo(m.combo[winner]);
    this.audio.damage(crit ? 1.4 : 1);
    const sp = this.screenPos(L.palmCenter(_v));
    this.ui.floater(`-${dmg}`, sp.x, sp.y - window.innerHeight * 0.08, {
      crit,
      color: loser === 0 ? '#1fd2ff' : '#ff2e63',
    });
    this.fx.dangerTarget = m.hp[0] <= 30 ? 1 : 0;

    if (m.hp[loser] <= 0) return this.knockout(sid, winner);

    await this.wait(1.05, sid);
    for (const h of this.hands) {
      this.tweens.to(h.anim, { x: 0, y: 0, rz: 0 }, 0.55, { ease: Ease.inOutCubic });
      h.glow = 1;
    }
    m.round++;
    this.ui.setRound(m.round);
    this.rig.shot('idle', 0.7);
    await this.wait(0.45, sid);
    this.beginRound(sid);
  }

  async knockout(sid, winner) {
    const loser = 1 - winner;
    const W = this.hands[winner];
    const L = this.hands[loser];
    this.state = 'ko';
    this.clock.slowMo(0.22, 1.0, 0.6);
    this.fx.knockout(loser, winner);
    this.audio.knockout();
    this.audio.powerDown();
    this.audio.music?.setMode('off');
    this.ui.callout('K.O.', 'ko', { duration: 2300 });
    this.haptic([0, 90, 50, 140]);
    L.impulse({ x: -9, y: 3.2, rz: 2.6 });
    L.setPose('relaxed', { stiffness: 60, damping: 6 });
    L.idle = 0;
    this.tweens.to(L, { power: 0.04 }, 1.4, { ease: Ease.inQuad });
    this.tweens.to(L.anim, { y: -0.75, rx: 0.5 }, 2.2, { ease: Ease.outBounce });
    this.rig.shot('ko', 0.5, Ease.outCubic);
    this.world.arena.energy = 1;

    await this.wait(1.25, sid);
    // Winner strikes a V pose.
    const playerWon = winner === 0;
    this.fx.desaturateTarget = playerWon ? 0 : 0.35;
    W.setPose('scissors', { stiffness: 320, damping: 20 });
    W.glow = 2.2;
    W.idle = 0.6;
    this.tweens.to(W.anim, { x: 0.9, y: 0.75, rz: 1.15, rx: -0.1 }, 0.9, { ease: Ease.outBack });
    this.rig.shot(playerWon ? 'victoryP1' : 'victoryP2', 1.3, Ease.inOutCubic);
    if (playerWon) this.audio.victory();
    else this.audio.defeat();
    for (let i = 0; i < 3; i++) {
      await this.wait(0.38, sid);
      this.fx.celebrate(winner);
    }
    this.audio.music?.setMode('result');
    await this.wait(0.6, sid);
    this.finishMatch(winner);
  }

  finishMatch(winner) {
    this.state = 'result';
    this.platform.keepAwake(false);
    const m = this.match;
    const victory = winner === 0;
    const s = this.storage.stats;
    const hpLeft = m.hp[0];
    const rank = victory ? (hpLeft >= 80 ? 'S' : hpLeft >= 50 ? 'A' : hpLeft >= 25 ? 'B' : 'C') : 'D';
    const badges = [];

    s.matches++;
    if (m.maxCombo[0] > (s.bestCombo || 0)) {
      if (s.bestCombo > 0) badges.push('BEST COMBO!');
      s.bestCombo = m.maxCombo[0];
    }
    if (victory) {
      s.wins++;
      s.streak++;
      if (s.streak > (s.bestStreak || 0)) s.bestStreak = s.streak;
      if (!s.cleared[m.difficulty]) badges.push(`${DIFFICULTIES[m.difficulty].label} CLEAR!`);
      s.cleared[m.difficulty] = true;
      const prev = s.bestRank[m.difficulty];
      if (!prev || RANK_ORDER.indexOf(rank) > RANK_ORDER.indexOf(prev)) {
        if (prev) badges.push('NEW RECORD!');
        s.bestRank[m.difficulty] = rank;
      }
      if (s.streak >= 2) badges.push(`${s.streak} WIN STREAK`);
      if (hpLeft === RULES.maxHp) badges.push('PERFECT!');
    } else {
      s.streak = 0;
    }
    this.storage.save();

    const D = DIFFICULTIES[m.difficulty];
    this.ui.showResult({
      victory,
      subtitle: victory ? `${D.name}（${D.label}）に勝利！` : `${D.name}（${D.label}）に敗北…　もう一度挑戦しよう`,
      rank,
      stats: [
        ['ROUNDS', m.round],
        ['WIN', m.wins],
        ['LOSE', m.losses],
        ['DRAW', m.draws],
        ['MAX COMBO', m.maxCombo[0]],
        ['CRITICAL', m.crits],
      ],
      usage: m.usage,
      badges,
    });
  }

  // ---------- Pause / settings ----------

  get inMatch() {
    return ['intro', 'choose', 'throw', 'ko'].includes(this.state);
  }

  pause() {
    if (this.paused || !this.inMatch) return;
    this.paused = true;
    this.clock.timeScale = 0;
    this.audio.suspend();
    this.ui.showPause(true, 'PAUSE');
  }

  resume() {
    if (!this.ui.pauseOpen) return;
    this.ui.showPause(false);
    if (this.paused) {
      this.paused = false;
      this.clock.timeScale = 1;
    }
    this.audio.resume();
  }

  // ---------- Input ----------

  _wireUI() {
    const ui = this.ui;
    ui.on('choice', (h) => this.choose(h));
    ui.on('key-choice', (h) => this.choose(h));
    ui.on('tapStart', () => this.tapStart());
    ui.on('ui', () => this.audio.ready && this.audio.ui());
    ui.on('start', (d) => {
      this.audio.unlock();
      this.startMatch(d).catch(this.onCancel);
    });
    ui.on('rematch', () => {
      this.audio.ui();
      this.startMatch(this.match?.difficulty || 'normal').catch(this.onCancel);
    });
    ui.on('toTitle', () => {
      this.audio.ui();
      this.enterTitle();
    });
    ui.on('quit', () => {
      this.ui.showPause(false);
      this.audio.resume();
      this.platform.keepAwake(false);
      this.enterTitle();
    });
    ui.on('pause', () => {
      this.audio.ui();
      this.pause();
    });
    ui.on('resume', () => this.resume());
    ui.on('settings', () => {
      this.audio.ui();
      this.ui.showPause(true, 'SETTINGS');
    });
    ui.on('howto', () => {
      this.audio.ui();
      this.ui.showHowto(true);
    });
    ui.on('howtoClose', () => {
      this.audio.ui();
      this.ui.showHowto(false);
    });
    ui.on('fullscreen', () => {
      this.audio.ui();
      this.platform.toggleFullscreen();
    });
    ui.on('key-pause', () => {
      if (this.ui.pauseOpen) this.resume();
      else if (!this.ui.els.howto.classList.contains('hidden')) this.ui.showHowto(false);
      else this.pause();
    });
    ui.on('key-confirm', () => {
      if (this.ui.pauseOpen || !this.ui.els.howto.classList.contains('hidden')) return;
      if (this.state === 'title') {
        if (!this.ui.started) this.tapStart();
        else this.startMatch(this.ui.selectedDiff).catch(this.onCancel);
      } else if (this.state === 'result') {
        this.startMatch(this.match?.difficulty || 'normal').catch(this.onCancel);
      }
    });
    ui.on('key-arrow', (d) => {
      if (this.state !== 'title' || !this.ui.started) return;
      const ids = Object.keys(DIFFICULTIES);
      const i = (ids.indexOf(this.ui.selectedDiff) + d + ids.length) % ids.length;
      this.ui.selectDifficulty(ids[i]);
      this.audio.ui();
    });
  }

}
