import { Ease } from './math.js';

// Minimal tween engine driven by the game clock.
export class Tweener {
  constructor() {
    this.list = [];
  }

  to(target, props, duration, opts = {}) {
    if (opts.overwrite !== false) this.kill(target, Object.keys(props));
    const tw = {
      target,
      props,
      duration: Math.max(1e-4, duration),
      ease: opts.ease || Ease.outCubic,
      delay: opts.delay || 0,
      real: !!opts.real,
      onUpdate: opts.onUpdate,
      onComplete: opts.onComplete,
      from: null,
      t: 0,
      done: false,
      resolve: null,
    };
    const promise = new Promise((r) => (tw.resolve = r));
    this.list.push(tw);
    return promise;
  }

  // Stop tweens on `target` (optionally only the given keys). Their promises resolve.
  kill(target, keys) {
    for (const tw of this.list) {
      if (tw.done || tw.target !== target) continue;
      if (keys && !keys.some((k) => k in tw.props)) continue;
      tw.done = true;
      tw.resolve();
    }
  }

  killAll() {
    for (const tw of this.list) {
      tw.done = true;
      tw.resolve();
    }
    this.list.length = 0;
  }

  update(dt, realDt) {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const tw = list[i];
      if (tw.done) continue;
      const d = tw.real ? realDt : dt;
      if (tw.delay > 0) {
        tw.delay -= d;
        if (tw.delay > 0) continue;
      }
      if (!tw.from) {
        tw.from = {};
        for (const k in tw.props) tw.from[k] = tw.target[k];
      }
      tw.t += d;
      const p = Math.min(1, tw.t / tw.duration);
      const e = tw.ease(p);
      for (const k in tw.props) tw.target[k] = tw.from[k] + (tw.props[k] - tw.from[k]) * e;
      if (tw.onUpdate) tw.onUpdate(e);
      if (p >= 1) {
        tw.done = true;
        if (tw.onComplete) tw.onComplete();
        tw.resolve();
      }
    }
    if (list.some((tw) => tw.done)) this.list = list.filter((tw) => !tw.done);
  }
}
