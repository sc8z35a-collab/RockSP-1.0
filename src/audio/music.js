// Procedural synthwave soundtrack: a lookahead step sequencer driving
// synthesized drums, bass, arpeggio and pads.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// A minor: Am - F - C - G (one chord per bar).
const CHORDS = [
  [57, 60, 64], // A C E
  [53, 57, 60], // F A C
  [48, 52, 55], // C E G
  [55, 59, 62], // G B D
];
const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 4, 3, 2, 1]; // indexes into an extended chord
const BASS_GATE = [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0];

export class Music {
  constructor(engine) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.bpm = 116;
    this.mode = 'off';
    this.step = 0;
    this.bar = 0;
    this.nextTime = 0;
    this.timer = null;

    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(engine.musicBus);

    // Dotted-eighth echo for the arpeggio.
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.32;
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 2200;
    this.delay.connect(this.delayTone);
    this.delayTone.connect(this.delayFb);
    this.delayFb.connect(this.delay);
    this.delayTone.connect(this.out);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.45;
    this.delaySend.connect(this.delay);

    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.5;
    this.verbSend.connect(engine.reverbSend);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    if (mode === 'off') {
      this.stop();
      return;
    }
    if (was === 'off' || !this.timer) this.start();
  }

  start() {
    if (this.timer) return;
    this.step = 0;
    this.bar = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this._schedule(), 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get stepDur() {
    return 60 / this.bpm / 4;
  }

  _schedule() {
    const ctx = this.ctx;
    if (ctx.state !== 'running') {
      this.nextTime = ctx.currentTime + 0.05;
      return;
    }
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.02;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar = (this.bar + 1) % 8;
    }
  }

  _playStep(s, t) {
    const m = this.mode;
    const battle = m === 'battle';
    const chord = CHORDS[this.bar % 4];

    // Drums.
    if (battle) {
      if (s % 4 === 0) this._kick(t, 0.8);
      if (s === 4 || s === 12) this._snare(t);
      if (s % 2 === 1) this._hat(t, s % 4 === 3 ? 0.06 : 0.035);
      if (s === 14 && this.bar % 2 === 1) this._hat(t, 0.05, true);
    } else if (m === 'title') {
      if (s === 0 || s === 10) this._kick(t, 0.45);
      if (s % 4 === 2) this._hat(t, 0.02);
    } else if (m === 'result') {
      if (s === 0) this._kick(t, 0.4);
    }

    // Bass.
    if (battle && BASS_GATE[s]) {
      const root = chord[0] - 24 + (s % 8 === 6 ? 12 : 0);
      this._bass(t, midi(root), this.stepDur * 0.9, 0.16);
    } else if (!battle && s === 0) {
      this._bass(t, midi(chord[0] - 24), this.stepDur * 15, 0.12);
    }

    // Arpeggio.
    const ext = [chord[0], chord[1], chord[2], chord[0] + 12, chord[1] + 12];
    const arpOn = battle || (m === 'title' && s % 2 === 0) || (m === 'result' && s % 4 === 0);
    if (arpOn) {
      const note = ext[ARP[s]] + 12;
      this._arp(t, midi(note), battle ? 0.045 : 0.035);
    }

    // Pad on each bar.
    if (s === 0) {
      for (const n of chord) this._pad(t, midi(n), this.stepDur * 16, battle ? 0.022 : 0.03);
    }
  }

  _voice(type, freq, t, { attack = 0.005, hold = 0, release = 0.1, gain = 0.1, filter = 0, filterEnd = 0, q = 1, detune = 0, send = 0, echo = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    if (hold > 0) g.gain.setValueAtTime(gain, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    let node = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = q;
      f.frequency.setValueAtTime(filter, t);
      if (filterEnd) f.frequency.exponentialRampToValueAtTime(filterEnd, t + attack + hold + release);
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.out);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.verbSend);
    }
    if (echo) {
      const s = ctx.createGain();
      s.gain.value = echo;
      g.connect(s);
      s.connect(this.delaySend);
    }
    o.start(t);
    o.stop(t + attack + hold + release + 0.05);
  }

  _kick(t, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + 0.35);
  }

  _noiseHit(t, { type, freq, q = 1, gain, release, send = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.e.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + release);
    src.connect(f);
    f.connect(g);
    g.connect(this.out);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s);
      s.connect(this.verbSend);
    }
    src.start(t, Math.random() * 1.5);
    src.stop(t + release + 0.05);
  }

  _snare(t) {
    this._noiseHit(t, { type: 'bandpass', freq: 1900, q: 0.8, gain: 0.28, release: 0.2, send: 0.5 });
    this._voice('triangle', 190, t, { release: 0.1, gain: 0.12 });
  }

  _hat(t, gain, open = false) {
    this._noiseHit(t, { type: 'highpass', freq: 7500, gain, release: open ? 0.22 : 0.045 });
  }

  _bass(t, freq, len, gain) {
    this._voice('sawtooth', freq, t, { attack: 0.004, hold: len * 0.3, release: len * 0.7, gain, filter: 900, filterEnd: 160, q: 4 });
    this._voice('sine', freq / 2, t, { attack: 0.004, hold: len * 0.4, release: len * 0.6, gain: gain * 0.9 });
  }

  _arp(t, freq, gain) {
    this._voice('square', freq, t, { attack: 0.003, release: 0.14, gain, filter: 2600, q: 2, echo: 1 });
  }

  _pad(t, freq, len, gain) {
    for (const d of [-9, 0, 9]) {
      this._voice('sawtooth', freq, t, { attack: 0.5, hold: len - 1.0, release: 1.2, gain, filter: 1300, q: 0.7, detune: d, send: 0.6 });
    }
  }
}
