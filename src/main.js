import './styles.css';
import * as THREE from 'three';
import { RenderCore } from './core/renderCore.js';
import { GameClock } from './core/time.js';
import { Tweener } from './core/tween.js';
import { World } from './world/world.js';
import { Effects } from './fx/effects.js';
import { CameraRig } from './fx/cameraRig.js';
import { AudioEngine } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { renderHandIcons } from './ui/handIcons.js';
import { Game } from './game/game.js';
import { Storage } from './game/storage.js';

const params = new URLSearchParams(location.search);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---- Platform helpers: fullscreen, orientation lock, wake lock ----
const platform = {
  isIOS:
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  get standalone() {
    return (
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches ||
      navigator.standalone === true
    );
  },
  get fullscreenSupported() {
    return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  },
  get showIosHint() {
    return this.isIOS && !this.standalone && !this.fullscreenSupported;
  },
  get isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  },
  async enterFullscreen() {
    if (this.isFullscreen || params.has('nofs')) return;
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch {
      /* fullscreen refused (iframe, iPhone, user setting) */
    }
    try {
      await screen.orientation?.lock?.('landscape');
    } catch {
      /* orientation lock unsupported */
    }
  },
  async exitFullscreen() {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch {
      /* ignore */
    }
  },
  toggleFullscreen() {
    if (this.isFullscreen) this.exitFullscreen();
    else this.enterFullscreen();
  },
  wakeLock: null,
  wantAwake: false,
  async keepAwake(on) {
    this.wantAwake = on;
    try {
      if (on && !this.wakeLock && navigator.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {
      this.wakeLock = null;
    }
  },
};

// Stop the browser from scrolling, zooming or bouncing the page.
const block = (e) => e.preventDefault();
document.addEventListener('gesturestart', block);
document.addEventListener('dblclick', block);
document.addEventListener('contextmenu', block);
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.target.closest && e.target.closest('.panel, .result-panel')) return;
    e.preventDefault();
  },
  { passive: false }
);

async function boot() {
  const ui = new UI();
  const storage = new Storage();
  ui.setLoading(0.05, 'BOOTING');
  await nextFrame();

  const canvas = document.getElementById('gl');
  let core;
  try {
    core = new RenderCore(canvas, { quality: params.get('q') || storage.settings.quality || 'auto' });
  } catch (err) {
    console.error(err);
    ui.fatal('このブラウザでは3D表示（WebGL2）が使えません。<br>Chrome / Safari の最新版で開いてください。');
    return;
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ui.fatal('グラフィックがリセットされました。<br>ページを再読み込みしてください。');
  });

  ui.setLoading(0.15, 'BUILDING ARENA');
  await nextFrame();
  const world = new World(core);
  const rig = new CameraRig(world.camera);
  ui.setLoading(0.45, 'ASSEMBLING ROBOTS');
  await nextFrame();
  const fx = new Effects(world, rig, core);
  core.setup(world.scene, world.camera);
  core.onResize((w, h, preset) => {
    world.applyQuality(w, h, preset);
    fx.setBudget(preset.particles);
  });

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    world.camera.aspect = w / h;
    world.camera.updateProjectionMatrix();
    core.resize(w, h);
  };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));
  resize();

  // Compile every shader up front (including normally hidden effects) to avoid hitches.
  ui.setLoading(0.6, 'COMPILING SHADERS');
  await nextFrame();
  const hidden = [];
  world.scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    await core.renderer.compileAsync(world.scene, world.camera);
  } catch {
    core.renderer.compile(world.scene, world.camera);
  }
  rig.update(0, 0);
  world.update(0, 0);
  world.render(0);
  for (const o of hidden) o.visible = false;

  ui.setLoading(0.85, 'CALIBRATING');
  await nextFrame();
  try {
    ui.setHandIcons(renderHandIcons(core.renderer, world.scene.environment, world.colorA));
  } catch (err) {
    console.warn('icon render failed', err);
  }

  const clock = new GameClock();
  const tweens = new Tweener();
  const audio = new AudioEngine();
  audio.sfxOn = storage.settings.sfx;
  audio.bgmOn = storage.settings.bgm;
  const game = new Game({ world, fx, rig, ui, audio, clock, tweens, storage, platform });

  ui.bindSettings(storage.settings, (key, value) => {
    storage.save();
    if (key === 'bgm') audio.setBgm(value);
    if (key === 'sfx') audio.setSfx(value);
    if (key === 'quality') core.setQualityMode(value);
    if (audio.ready) audio.ui();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.pause();
      audio.suspend();
    } else {
      if (!game.paused) audio.resume();
      if (platform.wantAwake) platform.keepAwake(true);
    }
  });
  const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
  portrait.addEventListener?.('change', () => {
    if (portrait.matches) game.pause();
  });

  // ---- Main loop ----
  let last = performance.now();
  let frames = 0;
  const fixedStep = params.has('fixedstep') ? 1 / 60 : 0;
  const fpsEl = params.has('fps') ? Object.assign(document.createElement('div'), { id: 'fps' }) : null;
  if (fpsEl) {
    fpsEl.style.cssText =
      'position:fixed;left:6px;bottom:6px;z-index:99;font:12px monospace;color:#9ff;background:#0008;padding:2px 6px;border-radius:4px;pointer-events:none';
    document.body.append(fpsEl);
  }
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const realDt = fixedStep || Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (document.hidden) return;
    clock.update(realDt);
    tweens.update(clock.dt, realDt);
    world.update(clock.dt, clock.elapsed);
    fx.update(clock.dt, realDt, clock.elapsed);
    rig.update(clock.dt, realDt);
    world.render(clock.dt);
    core.monitor(realDt);
    frames++;
    if (fpsEl && frames % 20 === 0) {
      fpsEl.textContent = `${core.fps.toFixed(0)} fps · ${core.level} · x${core.pixelRatio.toFixed(2)}`;
    }
  }

  ui.setLoading(1, 'READY');
  game.enterTitle();
  requestAnimationFrame(frame);
  await nextFrame();
  ui.hideLoading();

  if (params.has('debug')) {
    window.__rsp = {
      game,
      world,
      fx,
      rig,
      ui,
      clock,
      tweens,
      core,
      audio,
      THREE,
      frames: () => frames,
      renderIcons: (size) => renderHandIcons(core.renderer, world.scene.environment, world.colorA, size),
    };
  }
}

boot();
