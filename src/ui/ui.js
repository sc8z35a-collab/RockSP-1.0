import { DIFFICULTIES, HAND_INFO } from '../game/rules.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// Fallback hand icons (used until/if the 3D renders are unavailable).
const SVG_ICONS = {
  rock: `<svg viewBox="0 0 100 100" fill="none" stroke="#bff3ff" stroke-width="5" stroke-linejoin="round"><rect x="24" y="30" width="52" height="46" rx="14"/><path d="M24 44h52M37 30v14M50 30v14M63 30v14"/><path d="M24 58c8 0 14 4 18 10"/></svg>`,
  scissors: `<svg viewBox="0 0 100 100" fill="none" stroke="#bff3ff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"><path d="M38 52 30 14M54 52l10-38"/><rect x="28" y="50" width="46" height="34" rx="12"/><path d="M28 64h20"/></svg>`,
  paper: `<svg viewBox="0 0 100 100" fill="none" stroke="#bff3ff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"><path d="M32 54V22M44 50V14M56 50V16M68 54V26"/><path d="M28 54h46v14c0 10-8 18-18 18h-8c-10 0-20-8-20-18z"/><path d="M28 60l-10-12"/></svg>`,
};

// DOM layer: screens, HUD, callouts and input.
export class UI {
  constructor() {
    this.handlers = {};
    this.hp = [100, 100];
    this.selectedDiff = 'normal';
    this.started = false;

    this.els = {
      loading: $('loading'),
      loadFill: $('load-fill'),
      loadText: $('load-text'),
      title: $('title'),
      tapStart: $('tap-start'),
      menu: $('menu'),
      cards: $('diff-cards'),
      records: $('records'),
      iosHint: $('ios-hint'),
      hud: $('hud'),
      choices: $('choices'),
      callouts: $('callouts'),
      floaters: $('floaters'),
      prompt: $('prompt'),
      round: $('round-label'),
      result: $('result'),
      pause: $('pause'),
      pauseTitle: $('pause-title'),
      howto: $('howto'),
      toast: $('toast'),
      app: $('app'),
    };
    this.fighters = [0, 1].map((i) => {
      const p = `p${i + 1}`;
      return {
        name: $(`${p}-name`),
        fill: $(`${p}-fill`),
        ghost: $(`${p}-ghost`),
        num: $(`${p}-hp`),
        combo: $(`${p}-combo`),
        bar: $(`${p}-fill`).parentElement,
      };
    });

    this._setIcons(SVG_ICONS, true);
    this._buildCards();
    this._wire();
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, ...args) {
    if (this.handlers[name]) this.handlers[name](...args);
  }

  // ---- Loading ----
  setLoading(p, text) {
    this.els.loadFill.style.width = `${Math.round(p * 100)}%`;
    if (text) this.els.loadText.textContent = text;
  }

  hideLoading() {
    this.els.loading.classList.add('done');
    setTimeout(() => this.els.loading.classList.add('hidden'), 800);
  }

  fatal(message) {
    const box = this.els.loading;
    box.classList.remove('done', 'hidden');
    box.innerHTML = '';
    box.append(el('div', 'load-title', 'NEON CLASH'), el('div', 'load-error', message));
  }

  // ---- Icons ----
  _setIcons(map, isSvg = false) {
    document.querySelectorAll('[data-icon]').forEach((node) => {
      const key = node.dataset.icon;
      if (!map[key]) return;
      if (isSvg) node.innerHTML = map[key];
      else {
        node.innerHTML = '';
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.src = map[key];
        node.append(img);
      }
    });
  }

  setHandIcons(dataUrls) {
    if (dataUrls) this._setIcons(dataUrls, false);
  }

  // ---- Title ----
  _buildCards() {
    const wrap = this.els.cards;
    wrap.innerHTML = '';
    for (const d of Object.values(DIFFICULTIES)) {
      const b = el('button', 'card');
      b.dataset.diff = d.id;
      b.innerHTML = `
        <span class="stars">${'<b>★</b>'.repeat(d.stars)}${'★'.repeat(3 - d.stars)}</span>
        <span class="lvl">${d.label}</span>
        <span class="cpu">${d.name}</span>
        <span class="jp">${d.jp}</span>
        <span class="clear hidden">CLEAR</span>`;
      b.addEventListener('click', () => {
        this.selectDifficulty(d.id);
        this.emit('ui');
      });
      wrap.append(b);
    }
    this.descEl = el('div', 'diff-desc');
    wrap.after(this.descEl);
    this.selectDifficulty(this.selectedDiff);
  }

  selectDifficulty(id) {
    this.selectedDiff = id;
    this.els.cards.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.diff === id));
    this.descEl.textContent = DIFFICULTIES[id].desc;
  }

  setRecords(stats) {
    const cleared = stats.cleared || {};
    this.els.cards.querySelectorAll('.card').forEach((c) => {
      const clr = c.querySelector('.clear');
      const rank = stats.bestRank?.[c.dataset.diff];
      clr.classList.toggle('hidden', !cleared[c.dataset.diff]);
      clr.textContent = rank ? `CLEAR · ${rank}` : 'CLEAR';
    });
    const parts = [`WINS ${stats.wins || 0}`, `BEST COMBO ${stats.bestCombo || 0}`, `STREAK ${stats.bestStreak || 0}`];
    this.els.records.textContent = parts.join('   ·   ');
  }

  showTitle({ started }) {
    this.started = started;
    this.hideAllScreens();
    this.els.title.classList.remove('hidden');
    this.els.tapStart.classList.toggle('hidden', started);
    this.els.menu.classList.toggle('hidden', !started);
    this.els.hud.classList.add('hidden');
    this.hideChoices(true);
  }

  showMenu() {
    this.started = true;
    this.els.tapStart.classList.add('hidden');
    this.els.menu.classList.remove('hidden');
  }

  showIosHint(show) {
    this.els.iosHint.classList.toggle('hidden', !show);
  }

  hideAllScreens() {
    for (const k of ['title', 'result', 'pause', 'howto']) this.els[k].classList.add('hidden');
  }

  // ---- HUD ----
  showHud(p1Name, p2Name) {
    this.hideAllScreens();
    this.els.hud.classList.remove('hidden');
    this.fighters[0].name.textContent = p1Name;
    this.fighters[1].name.textContent = p2Name;
    this.setHp(0, 100, false);
    this.setHp(1, 100, false);
    this.setCombo(0, 0);
    this.setCombo(1, 0);
  }

  hideHud() {
    this.els.hud.classList.add('hidden');
  }

  setRound(n) {
    this.els.round.textContent = `ROUND ${n}`;
  }

  setHp(side, value, animate = true) {
    const f = this.fighters[side];
    const v = Math.max(0, value);
    const s = `scaleX(${v / 100})`;
    if (!animate) {
      f.fill.style.transition = 'none';
      f.ghost.style.transition = 'none';
      f.fill.style.transform = s;
      f.ghost.style.transform = s;
      void f.fill.offsetWidth;
      f.fill.style.transition = '';
      f.ghost.style.transition = '';
    } else {
      f.fill.style.transform = s;
      f.ghost.style.transform = s;
      f.bar.classList.remove('hit');
      void f.bar.offsetWidth;
      f.bar.classList.add('hit');
    }
    f.bar.classList.toggle('low', v > 0 && v <= 30);
    this._countTo(f.num, this.hp[side], v, animate ? 450 : 0);
    this.hp[side] = v;
  }

  _countTo(node, from, to, ms) {
    if (ms <= 0) {
      node.textContent = String(Math.round(to));
      return;
    }
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      node.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setCombo(side, n) {
    const c = this.fighters[side].combo;
    if (n >= 2) {
      c.textContent = `${n} COMBO`;
      c.classList.remove('pop');
      void c.offsetWidth;
      c.classList.add('pop');
    } else {
      c.textContent = '';
    }
  }

  setPrompt(text) {
    const p = this.els.prompt;
    if (!text) {
      p.classList.remove('show');
      return;
    }
    p.textContent = text;
    p.classList.add('show');
  }

  // ---- Choices ----
  showChoices() {
    const c = this.els.choices;
    c.classList.remove('hidden', 'locked', 'leaving');
    c.querySelectorAll('.choice').forEach((b) => {
      b.classList.remove('chosen', 'press');
      b.style.animation = 'none';
      void b.offsetWidth;
      b.style.animation = '';
    });
  }

  lockChoice(hand) {
    const c = this.els.choices;
    c.classList.add('locked');
    c.querySelectorAll('.choice').forEach((b) => b.classList.toggle('chosen', b.dataset.hand === hand));
  }

  hideChoices(instant = false) {
    const c = this.els.choices;
    if (instant) {
      c.classList.add('hidden');
      return;
    }
    c.classList.add('leaving');
    setTimeout(() => {
      if (c.classList.contains('leaving')) c.classList.add('hidden');
    }, 350);
  }

  // ---- Callouts ----
  callout(text, cls, { duration = 1400, from = null } = {}) {
    const node = el('div', `callout ${cls}`);
    const span = el('span', 'txt');
    span.textContent = text;
    node.append(span);
    if (from) node.style.setProperty('--from', from);
    this.els.callouts.append(node);
    setTimeout(() => node.remove(), duration);
    return node;
  }

  clearCallouts() {
    this.els.callouts.innerHTML = '';
    this.els.floaters.innerHTML = '';
  }

  // Fighting-game style "YOU VS CPU" splash.
  versus(left, right, rightSub, duration = 1750) {
    const node = el('div', 'callout vs');
    node.innerHTML = `
      <div class="vs-band"></div>
      <div class="vs-side left"><span class="vs-name"></span><span class="vs-tag">PLAYER</span></div>
      <div class="vs-mark">VS</div>
      <div class="vs-side right"><span class="vs-name"></span><span class="vs-tag"></span></div>`;
    node.querySelector('.left .vs-name').textContent = left;
    node.querySelector('.right .vs-name').textContent = right;
    node.querySelector('.right .vs-tag').textContent = rightSub;
    this.els.callouts.append(node);
    setTimeout(() => node.remove(), duration);
  }

  banner(text, extraCls = '', duration = 1300) {
    return this.callout(text, `banner ${extraCls}`, { duration });
  }

  floater(text, x, y, { crit = false, color = '#ff3b5c' } = {}) {
    const node = el('div', `floater${crit ? ' crit' : ''}`);
    node.textContent = text;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.setProperty('--glow', color);
    this.els.floaters.append(node);
    setTimeout(() => node.remove(), 1400);
  }

  shake() {
    const a = this.els.hud;
    a.classList.remove('shake');
    void a.offsetWidth;
    a.classList.add('shake');
  }

  toast(text) {
    const t = el('div', 'toast-item');
    t.textContent = text;
    this.els.toast.append(t);
    setTimeout(() => t.remove(), 2700);
  }

  // ---- Result ----
  showResult(r) {
    this.els.hud.classList.add('hidden');
    this.hideChoices(true);
    const title = $('result-title');
    title.textContent = r.victory ? 'VICTORY' : 'DEFEAT';
    title.classList.toggle('defeat', !r.victory);
    $('result-sub').textContent = r.subtitle;
    $('result-rank').textContent = r.rank;
    const stats = $('result-stats');
    stats.innerHTML = '';
    for (const [k, v] of r.stats) {
      const s = el('div', 'stat');
      s.append(el('div', 'k', k), el('div', 'v', String(v)));
      stats.append(s);
    }
    const usage = $('result-usage');
    usage.innerHTML = '';
    const total = Math.max(1, r.usage.rock + r.usage.scissors + r.usage.paper);
    for (const h of ['rock', 'scissors', 'paper']) {
      const pct = Math.round((r.usage[h] / total) * 100);
      const u = el('div', 'usage');
      u.innerHTML = `<span>${HAND_INFO[h].jp}</span><span class="bar"><i style="width:${pct}%"></i></span><span>${pct}%</span>`;
      usage.append(u);
    }
    const badges = $('result-badges');
    badges.innerHTML = '';
    for (const b of r.badges) badges.append(el('div', 'badge', b));
    this.els.result.classList.remove('hidden');
  }

  // ---- Pause & settings ----
  showPause(show, title = 'PAUSE') {
    this.els.pauseTitle.textContent = title;
    this.els.pause.classList.toggle('hidden', !show);
    $('btn-quit').classList.toggle('hidden', title !== 'PAUSE');
    $('btn-resume').querySelector('span').textContent = title === 'PAUSE' ? 'RESUME' : 'OK';
    $('btn-resume').querySelector('small').textContent = title === 'PAUSE' ? 'つづける' : 'とじる';
  }

  get pauseOpen() {
    return !this.els.pause.classList.contains('hidden');
  }

  showHowto(show) {
    this.els.howto.classList.toggle('hidden', !show);
  }

  bindSettings(settings, onChange) {
    const bind = (id, key) => {
      const input = $(id);
      input.checked = !!settings[key];
      input.addEventListener('change', () => {
        settings[key] = input.checked;
        onChange(key, input.checked);
      });
    };
    bind('set-bgm', 'bgm');
    bind('set-sfx', 'sfx');
    bind('set-vibe', 'vibe');
    const seg = $('set-quality');
    const paint = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.q === settings.quality));
    seg.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        settings.quality = b.dataset.q;
        paint();
        onChange('quality', b.dataset.q);
      })
    );
    paint();
  }

  // ---- Input wiring ----
  _wire() {
    const press = (fn) => (e) => {
      e.preventDefault();
      fn(e);
    };
    this.els.choices.querySelectorAll('.choice').forEach((b) => {
      b.addEventListener('pointerdown', () => b.classList.add('press'));
      b.addEventListener('pointerup', () => b.classList.remove('press'));
      b.addEventListener('pointerleave', () => b.classList.remove('press'));
      b.addEventListener('click', press(() => this.emit('choice', b.dataset.hand)));
    });

    // `click` is a reliable user-activation event on every mobile browser, which the
    // audio unlock and the fullscreen request both need.
    this.els.title.addEventListener('click', () => {
      if (!this.started) this.emit('tapStart');
    });
    $('btn-start').addEventListener('click', press(() => this.emit('start', this.selectedDiff)));
    $('btn-howto').addEventListener('click', press(() => this.emit('howto')));
    $('btn-settings').addEventListener('click', press(() => this.emit('settings')));
    $('btn-fullscreen').addEventListener('click', press(() => this.emit('fullscreen')));
    $('btn-pause').addEventListener('click', press(() => this.emit('pause')));
    $('btn-resume').addEventListener('click', press(() => this.emit('resume')));
    $('btn-quit').addEventListener('click', press(() => this.emit('quit')));
    $('btn-rematch').addEventListener('click', press(() => this.emit('rematch')));
    $('btn-title').addEventListener('click', press(() => this.emit('toTitle')));
    $('btn-howto-close').addEventListener('click', press(() => this.emit('howtoClose')));

    const keyHands = { 1: 'rock', 2: 'scissors', 3: 'paper', a: 'rock', s: 'scissors', d: 'paper', j: 'rock', k: 'scissors', l: 'paper' };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      document.body.classList.add('has-keyboard');
      const k = e.key.toLowerCase();
      if (keyHands[k]) this.emit('key-choice', keyHands[k]);
      else if (k === 'escape' || k === 'p') this.emit('key-pause');
      else if (k === 'enter' || k === ' ') this.emit('key-confirm');
      else if (k === 'arrowleft' || k === 'arrowright') this.emit('key-arrow', k === 'arrowleft' ? -1 : 1);
    });
  }
}
