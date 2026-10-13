import { Ease, lerp } from './math.js';

// Game clock with time scaling, hit-stop and slow motion.
// `dt` is scaled game time; `realDt` is wall-clock time (used by UI-ish things).
export class GameClock {
  constructor() {
    this.timeScale = 1; // set to 0 while paused
    this.elapsed = 0;
    this.realElapsed = 0;
    this.dt = 0;
    this.realDt = 0;
    this._hitStop = 0;
    this._slow = null;
    this._timers = [];
  }

  // Freeze the game for a few real-time seconds (impact feel).
  hitStop(seconds) {
    this._hitStop = Math.max(this._hitStop, seconds);
  }

  // Run at `scale` speed for `hold` real seconds, then ease back to 1 over `recover`.
  slowMo(scale, hold, recover = 0.35) {
    this._slow = { scale, hold, recover, t: 0 };
  }

  get effectiveScale() {
    let s = this.timeScale;
    if (this._hitStop > 0) return 0;
    const sl = this._slow;
    if (sl) {
      if (sl.t < sl.hold) s *= sl.scale;
      else s *= lerp(sl.scale, 1, Ease.inOutQuad(Math.min(1, (sl.t - sl.hold) / sl.recover)));
    }
    return s;
  }

  update(realDt) {
    this.realDt = realDt;
    this.realElapsed += realDt;
    const scale = this.effectiveScale;
    if (this._hitStop > 0) this._hitStop -= realDt;
    if (this._slow && this.timeScale > 0) {
      this._slow.t += realDt;
      if (this._slow.t > this._slow.hold + this._slow.recover) this._slow = null;
    }
    this.dt = realDt * scale;
    this.elapsed += this.dt;

    const timers = this._timers;
    for (let i = timers.length - 1; i >= 0; i--) {
      const t = timers[i];
      t.remaining -= t.real ? realDt : this.dt;
      if (t.remaining <= 0) {
        timers.splice(i, 1);
        t.resolve();
      }
    }
  }

  // Promise that resolves after `seconds` of game time (or real time).
  wait(seconds, real = false) {
    return new Promise((resolve) => {
      this._timers.push({ remaining: seconds, resolve, real });
    });
  }

  // Drop every pending wait. Awaiting flows simply never resume (cancellation).
  cancelWaits() {
    this._timers.length = 0;
  }

  resetEffects() {
    this._hitStop = 0;
    this._slow = null;
  }
}
