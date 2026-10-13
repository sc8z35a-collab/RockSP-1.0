import { Music } from './music.js';

// All sound is synthesized with the Web Audio API (no audio files).
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.bgmOn = true;
    this.music = null;
  }

  get ready() {
    return !!this.ctx;
  }

  // Must be called from a user gesture (tap / click / key).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(comp);

      this.sfx = ctx.createGain();
      this.sfx.gain.value = this.sfxOn ? 0.9 : 0;
      this.sfx.connect(this.master);

      this.musicDuck = ctx.createGain();
      this.musicDuck.gain.value = 1;
      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 18000;
      this.musicFilter.Q.value = 0.8;
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.bgmOn ? 0.5 : 0;
      this.musicBus.connect(this.musicFilter);
      this.musicFilter.connect(this.musicDuck);
      this.musicDuck.connect(this.master);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(2.4, 2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.32;
      this.reverbSend.connect(this.reverb);
      this.reverb.connect(this.master);

      this.noiseBuffer = this._noise(2);
      this.music = new Music(this);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.ctx) this.sfx.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
  }

  setBgm(on) {
    this.bgmOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
  }

  // ---- Building blocks ----

  _noise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // Envelope helper: attack to `peak`, exponential release to silence.
  _env(gainNode, t, peak, attack, release, hold = 0) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  tone({
    type = 'sine',
    freq = 440,
    freqEnd = null,
    t = this.now,
    attack = 0.005,
    hold = 0,
    release = 0.2,
    gain = 0.3,
    detune = 0,
    filter = null,
    q = 1,
    dest = null,
    reverb = 0,
    pan = 0,
  }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + attack + hold + release);
    o.detune.value = detune;
    const g = ctx.createGain();
    this._env(g, t, gain, attack, release, hold);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      f.Q.value = q;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    let out = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(dest || this.sfx);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      out.connect(s);
      s.connect(this.reverbSend);
    }
    o.start(t);
    o.stop(t + attack + hold + release + 0.05);
  }

  noise({
    t = this.now,
    attack = 0.003,
    hold = 0,
    release = 0.2,
    gain = 0.3,
    type = 'bandpass',
    freq = 1000,
    freqEnd = null,
    q = 1,
    dest = null,
    reverb = 0,
    pan = 0,
  }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + attack + hold + release);
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, gain, attack, release, hold);
    src.connect(f);
    f.connect(g);
    let out = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      out = p;
    }
    out.connect(dest || this.sfx);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      out.connect(s);
      s.connect(this.reverbSend);
    }
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + hold + release + 0.05);
  }

  // Briefly lower the music so impacts punch through.
  duck(amount = 0.35, hold = 0.25, recover = 0.6) {
    if (!this.ctx) return;
    const g = this.musicDuck.gain;
    const t = this.now;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(amount, t + 0.03);
    g.setValueAtTime(amount, t + 0.03 + hold);
    g.linearRampToValueAtTime(1, t + 0.03 + hold + recover);
  }

  // Muffle the music (0 = open, 1 = heavily filtered) for tension.
  tension(x, time = 0.15) {
    if (!this.ctx) return;
    const f = 18000 * Math.pow(500 / 18000, Math.max(0, Math.min(1, x)));
    this.musicFilter.frequency.setTargetAtTime(f, this.now, time / 3);
  }

  // ---- Sound effects ----

  ui() {
    this.tone({ type: 'sine', freq: 1500, freqEnd: 900, release: 0.06, gain: 0.12 });
    this.noise({ type: 'highpass', freq: 5000, release: 0.02, gain: 0.05 });
  }

  select() {
    const t = this.now;
    this.tone({ type: 'triangle', freq: 784, t, release: 0.08, gain: 0.16 });
    this.tone({ type: 'triangle', freq: 1175, t: t + 0.06, release: 0.14, gain: 0.16, reverb: 0.3 });
  }

  start() {
    const t = this.now;
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ type: 'square', freq: f, t: t + i * 0.055, release: 0.16, gain: 0.07, filter: 3000, reverb: 0.3 })
    );
    this.noise({ t, type: 'bandpass', freq: 600, freqEnd: 5000, attack: 0.15, release: 0.2, gain: 0.12, q: 0.7 });
  }

  // Chant beats. i: 0 = "じゃん", 1 = "けん"; aiko = "あいこで".
  chant(i) {
    const t = this.now;
    const notes = [440, 554.37, 659.25];
    this.tone({ type: 'sine', freq: 150, freqEnd: 45, t, release: 0.22, gain: 0.7 });
    this.noise({ t, type: 'bandpass', freq: 1800, release: 0.07, gain: 0.25, q: 0.9 });
    this.tone({ type: 'sawtooth', freq: notes[i] || 440, t, release: 0.16, gain: 0.09, filter: 2400, reverb: 0.25 });
    this.tone({ type: 'square', freq: (notes[i] || 440) / 2, t, release: 0.12, gain: 0.05, filter: 1200 });
  }

  // "ぽん!" — the throw.
  pon() {
    const t = this.now;
    this.noise({ t, type: 'bandpass', freq: 500, freqEnd: 4500, attack: 0.02, release: 0.22, gain: 0.35, q: 1.2 });
    this.tone({ type: 'sawtooth', freq: 659.25, t, release: 0.25, gain: 0.08, filter: 3000, reverb: 0.3 });
    this.tone({ type: 'sawtooth', freq: 880, t, release: 0.25, gain: 0.06, filter: 3000, detune: 8 });
  }

  whoosh(dur = 0.25, gain = 0.3) {
    this.noise({ type: 'bandpass', freq: 300, freqEnd: 3200, attack: dur * 0.6, release: dur * 0.5, gain, q: 1.4 });
  }

  clash() {
    const t = this.now;
    this.tone({ type: 'sine', freq: 140, freqEnd: 32, t, release: 0.55, gain: 0.95 });
    this.noise({ t, type: 'lowpass', freq: 2500, freqEnd: 300, release: 0.35, gain: 0.55 });
    [523, 1187, 1873, 2711].forEach((f, i) =>
      this.tone({ type: 'sine', freq: f, t, release: 0.9 - i * 0.15, gain: 0.07, reverb: 0.6, pan: i % 2 ? 0.3 : -0.3 })
    );
    this.duck(0.3, 0.2, 0.7);
  }

  crush() {
    const t = this.now;
    this.tone({ type: 'sine', freq: 110, freqEnd: 28, t, release: 0.7, gain: 1.0 });
    this.tone({ type: 'square', freq: 70, freqEnd: 30, t, release: 0.3, gain: 0.25, filter: 600 });
    this.noise({ t, type: 'lowpass', freq: 3500, freqEnd: 200, release: 0.6, gain: 0.7, reverb: 0.4 });
    for (let i = 0; i < 6; i++) {
      this.noise({
        t: t + 0.05 + i * 0.045 + Math.random() * 0.03,
        type: 'bandpass',
        freq: 1500 + Math.random() * 3000,
        release: 0.05,
        gain: 0.18,
        q: 3,
        pan: Math.random() - 0.5,
      });
    }
    this.duck(0.25, 0.3, 0.8);
  }

  slash() {
    const t = this.now;
    for (let k = 0; k < 2; k++) {
      const tk = t + k * 0.09;
      this.noise({ t: tk, type: 'highpass', freq: 2500, freqEnd: 9000, attack: 0.01, release: 0.16, gain: 0.4, pan: k ? 0.4 : -0.4 });
      this.tone({ type: 'sine', freq: 2600 + k * 500, freqEnd: 1800, t: tk, release: 0.5, gain: 0.08, reverb: 0.5 });
    }
    this.tone({ type: 'sine', freq: 90, freqEnd: 35, t, release: 0.35, gain: 0.6 });
    this.duck(0.35, 0.2, 0.6);
  }

  wrap() {
    const t = this.now;
    this.noise({ t, type: 'bandpass', freq: 200, freqEnd: 2600, attack: 0.5, release: 0.3, gain: 0.35, q: 4 });
    this.tone({ type: 'sine', freq: 180, freqEnd: 900, t, attack: 0.5, release: 0.25, gain: 0.18, reverb: 0.4 });
    this.tone({ type: 'triangle', freq: 360, freqEnd: 1800, t, attack: 0.5, release: 0.25, gain: 0.07, detune: 12 });
  }

  wrapPop() {
    const t = this.now;
    this.tone({ type: 'sine', freq: 160, freqEnd: 35, t, release: 0.55, gain: 0.95 });
    this.noise({ t, type: 'lowpass', freq: 5000, freqEnd: 400, release: 0.4, gain: 0.5, reverb: 0.4 });
    this.tone({ type: 'sine', freq: 1320, t, release: 0.6, gain: 0.08, reverb: 0.6 });
    this.duck(0.3, 0.25, 0.7);
  }

  repel() {
    const t = this.now;
    this.tone({ type: 'sine', freq: 300, freqEnd: 120, t, release: 0.3, gain: 0.5 });
    this.tone({ type: 'triangle', freq: 1318, t, release: 0.4, gain: 0.08, reverb: 0.5 });
    this.tone({ type: 'triangle', freq: 1318 * 1.5, t: t + 0.08, release: 0.4, gain: 0.06, reverb: 0.5 });
  }

  damage(power = 1) {
    const t = this.now;
    this.tone({ type: 'square', freq: 220, freqEnd: 80, t, release: 0.2, gain: 0.12 * power, filter: 1600 });
    this.noise({ t, type: 'bandpass', freq: 900, release: 0.12, gain: 0.15 * power, q: 1.5 });
  }

  critical() {
    const t = this.now;
    [1568, 2093, 2637, 3136].forEach((f, i) =>
      this.tone({ type: 'triangle', freq: f, t: t + i * 0.04, release: 0.35, gain: 0.07, reverb: 0.6 })
    );
  }

  combo(n) {
    const t = this.now;
    const base = 523.25 * Math.pow(2, Math.min(n, 8) / 12);
    this.tone({ type: 'square', freq: base, t, release: 0.08, gain: 0.06, filter: 4000 });
    this.tone({ type: 'square', freq: base * 1.5, t: t + 0.06, release: 0.14, gain: 0.06, filter: 4000, reverb: 0.3 });
  }

  win() {
    const t = this.now;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this.tone({ type: 'square', freq: f, t: t + i * 0.07, release: 0.18, gain: 0.06, filter: 4500, reverb: 0.25 })
    );
    this.tone({ type: 'sawtooth', freq: 1046.5, t: t + 0.28, release: 0.5, gain: 0.05, filter: 3500, reverb: 0.4 });
  }

  lose() {
    const t = this.now;
    [392, 311.13, 261.63].forEach((f, i) =>
      this.tone({ type: 'triangle', freq: f, t: t + i * 0.13, release: 0.3, gain: 0.12, reverb: 0.3 })
    );
  }

  draw() {
    const t = this.now;
    this.tone({ type: 'triangle', freq: 659.25, t, release: 0.12, gain: 0.12 });
    this.tone({ type: 'triangle', freq: 659.25, t: t + 0.12, release: 0.25, gain: 0.12, reverb: 0.3 });
  }

  fight() {
    const t = this.now;
    this.noise({ t, type: 'bandpass', freq: 300, freqEnd: 6000, attack: 0.25, release: 0.15, gain: 0.3, q: 1 });
    this.tone({ type: 'sine', freq: 120, freqEnd: 40, t: t + 0.25, release: 0.5, gain: 0.9 });
    [220, 277.18, 329.63, 440].forEach((f) =>
      this.tone({ type: 'sawtooth', freq: f, t: t + 0.25, release: 0.6, gain: 0.05, filter: 2500, reverb: 0.5, detune: Math.random() * 10 - 5 })
    );
    this.duck(0.4, 0.4, 0.8);
  }

  round() {
    const t = this.now;
    this.tone({ type: 'sine', freq: 880, t, release: 0.3, gain: 0.1, reverb: 0.4 });
    this.tone({ type: 'sine', freq: 1320, t: t + 0.05, release: 0.3, gain: 0.06, reverb: 0.4 });
  }

  knockout() {
    const t = this.now;
    this.tone({ type: 'sine', freq: 90, freqEnd: 22, t, release: 1.6, gain: 1.0 });
    this.noise({ t, type: 'lowpass', freq: 6000, freqEnd: 120, release: 1.4, gain: 0.8, reverb: 0.6 });
    this.tone({ type: 'sawtooth', freq: 440, freqEnd: 40, t: t + 0.1, release: 1.2, gain: 0.08, filter: 1500 });
    this.duck(0.05, 1.5, 1.5);
  }

  victory() {
    const t = this.now + 0.05;
    const seq = [
      [523.25, 0, 0.12],
      [659.25, 0.12, 0.12],
      [783.99, 0.24, 0.12],
      [1046.5, 0.36, 0.5],
      [987.77, 0.9, 0.12],
      [1046.5, 1.02, 0.7],
    ];
    for (const [f, dt, len] of seq) {
      this.tone({ type: 'square', freq: f, t: t + dt, hold: len * 0.6, release: len * 0.5, gain: 0.06, filter: 3800, reverb: 0.35 });
      this.tone({ type: 'sawtooth', freq: f / 2, t: t + dt, hold: len * 0.6, release: len * 0.5, gain: 0.04, filter: 1800 });
    }
    [261.63, 329.63, 392].forEach((f) =>
      this.tone({ type: 'sawtooth', freq: f, t: t + 1.02, attack: 0.05, hold: 0.6, release: 1.2, gain: 0.035, filter: 2200, reverb: 0.5 })
    );
  }

  defeat() {
    const t = this.now + 0.05;
    [
      [392, 0],
      [369.99, 0.35],
      [349.23, 0.7],
      [329.63, 1.05],
    ].forEach(([f, dt]) => this.tone({ type: 'triangle', freq: f, t: t + dt, hold: 0.2, release: 0.5, gain: 0.12, reverb: 0.4 }));
    [220, 261.63, 311.13].forEach((f) =>
      this.tone({ type: 'sawtooth', freq: f, t: t + 1.05, attack: 0.1, hold: 0.5, release: 1.5, gain: 0.03, filter: 1200, reverb: 0.6 })
    );
  }

  powerDown() {
    const t = this.now;
    this.tone({ type: 'sawtooth', freq: 600, freqEnd: 30, t, release: 1.1, gain: 0.08, filter: 2000 });
  }
}
