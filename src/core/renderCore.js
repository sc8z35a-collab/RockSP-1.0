import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FinalShader } from './finalShader.js';
import { clamp } from './math.js';

export const QUALITY_PRESETS = {
  high: { maxDpr: 2.0, msaa: 4, shadows: true, shadowSize: 1024, reflection: 0.5, particles: 1.0, minScale: 0.72, lights: true },
  medium: { maxDpr: 1.6, msaa: 2, shadows: true, shadowSize: 1024, reflection: 0.38, particles: 0.75, minScale: 0.62, lights: true },
  low: { maxDpr: 1.15, msaa: 0, shadows: false, shadowSize: 512, reflection: 0, particles: 0.5, minScale: 0.55, lights: false },
};
const LEVELS = ['high', 'medium', 'low'];

// Owns the WebGL renderer, the post-processing chain and adaptive quality.
export class RenderCore {
  constructor(canvas, { quality = 'auto' } = {}) {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 1);
    this.renderer = renderer;

    const ext = renderer.extensions;
    this.hdr = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');

    this.mode = quality; // auto | high | medium | low
    this.level = quality === 'auto' ? this._initialLevel() : quality;
    this.scale = 1;
    this.width = 1;
    this.height = 1;
    this.listeners = [];

    this._frames = [];
    this._windowTime = 0;
    this._slowWindows = 0;
    this._fastWindows = 0;
    this._cooldown = 2.5; // ignore the first seconds (shader warm-up)
    this.fps = 60;
  }

  get preset() {
    return QUALITY_PRESETS[this.level];
  }

  _initialLevel() {
    const cores = navigator.hardwareConcurrency || 8;
    const mem = navigator.deviceMemory || 8;
    if (cores <= 4 || mem <= 3) return 'medium';
    return 'high';
  }

  setup(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    const rt = new THREE.WebGLRenderTarget(4, 4, {
      type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: this.preset.msaa,
    });
    const composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.0);
    this.finalPass = new ShaderPass(FinalShader);
    composer.addPass(this.renderPass);
    composer.addPass(this.bloomPass);
    composer.addPass(this.finalPass);
    this.composer = composer;
    this.post = this.finalPass.uniforms;
  }

  onResize(fn) {
    this.listeners.push(fn);
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this._apply();
  }

  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.preset.maxDpr) * this.scale;
  }

  _apply() {
    const pr = this.pixelRatio;
    const { width, height } = this;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(width, height);
      this.post.uResolution.value.set(Math.round(width * pr), Math.round(height * pr));
    }
    for (const fn of this.listeners) fn(Math.round(width * pr), Math.round(height * pr), this.preset);
  }

  setQualityMode(mode) {
    this.mode = mode;
    const level = mode === 'auto' ? this._initialLevel() : mode;
    this.scale = 1;
    this.setLevel(level);
  }

  setLevel(level) {
    if (!QUALITY_PRESETS[level]) return;
    this.level = level;
    const p = this.preset;
    if (this.composer) {
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        if (rt.samples !== p.msaa) {
          rt.samples = p.msaa;
          rt.dispose();
        }
      }
    }
    this._cooldown = 2.5;
    this._frames.length = 0;
    this._apply();
  }

  render(dt) {
    this.composer.render(dt);
  }

  // Adaptive resolution / quality. Called once per frame with the real frame time.
  monitor(realDt) {
    if (realDt <= 0 || realDt > 0.25) return; // tab switches, compile stalls
    this._frames.push(realDt * 1000);
    this._windowTime += realDt;
    if (this._cooldown > 0) {
      this._cooldown -= realDt;
      if (this._cooldown <= 0) {
        this._frames.length = 0;
        this._windowTime = 0;
      }
      return;
    }
    if (this._windowTime < 1.0) return;

    const frames = this._frames;
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    const variance = frames.reduce((a, b) => a + (b - avg) * (b - avg), 0) / frames.length;
    this.fps = 1000 / avg;
    frames.length = 0;
    this._windowTime = 0;
    if (this.mode !== 'auto') return;

    // A rock-steady ~33ms cadence means the browser caps at 30fps (e.g. iOS low
    // power mode), not that the GPU is struggling: don't punish quality for it.
    const capped30 = Math.abs(avg - 33.3) < 2 && Math.sqrt(variance) < 2;

    if (avg > 23 && !capped30) {
      this._slowWindows++;
      this._fastWindows = 0;
      if (this._slowWindows >= 2) {
        this._slowWindows = 0;
        const p = this.preset;
        if (this.scale > p.minScale + 0.01) {
          this.scale = clamp(this.scale - 0.12, p.minScale, 1);
          this._cooldown = 1.0;
          this._apply();
        } else {
          const idx = LEVELS.indexOf(this.level);
          if (idx < LEVELS.length - 1) {
            this.scale = 0.9;
            this.setLevel(LEVELS[idx + 1]);
          }
        }
      }
    } else if (avg < 15.5) {
      this._slowWindows = 0;
      this._fastWindows++;
      if (this._fastWindows >= 4 && this.scale < 1) {
        this._fastWindows = 0;
        this.scale = clamp(this.scale + 0.08, 0.5, 1);
        this._cooldown = 1.0;
        this._apply();
      }
    } else {
      this._slowWindows = Math.max(0, this._slowWindows - 1);
      this._fastWindows = 0;
    }
  }
}
