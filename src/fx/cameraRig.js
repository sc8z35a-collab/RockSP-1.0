import * as THREE from 'three';
import { Ease, Spring, noise1, clamp } from '../core/math.js';

// Named camera framings. Positions are tuned for a ~2:1 landscape phone screen.
export const SHOTS = {
  idle: { pos: [0, 2.3, 5.75], look: [0, 1.2, 0], fov: 38, roll: 0 },
  chant1: { pos: [0, 2.2, 5.5], look: [0, 1.25, 0], fov: 37.5, roll: 0.015 },
  chant2: { pos: [0, 2.08, 5.25], look: [0, 1.28, 0], fov: 37, roll: -0.02 },
  clash: { pos: [0, 1.85, 4.3], look: [0, 1.32, 0], fov: 40, roll: 0 },
  focusP1: { pos: [-1.1, 1.95, 4.4], look: [-1.0, 1.3, 0], fov: 38, roll: 0.03 },
  focusP2: { pos: [1.1, 1.95, 4.4], look: [1.0, 1.3, 0], fov: 38, roll: -0.03 },
  ko: { pos: [0, 1.55, 3.9], look: [0, 1.35, 0], fov: 44, roll: 0 },
  intro: { pos: [0, 4.6, 9.5], look: [0, 1.0, 0], fov: 42, roll: 0 },
  victoryP1: { pos: [-1.6, 1.9, 3.6], look: [-1.0, 1.75, 0], fov: 36, roll: 0.04 },
  victoryP2: { pos: [1.6, 1.9, 3.6], look: [1.0, 1.75, 0], fov: 36, roll: -0.04 },
};

const DESIGN_ASPECT = 2.05;

// Drives the camera: tweened framings, orbiting for the title screen,
// trauma-based shake, FOV punch and aspect-ratio fitting.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(...SHOTS.idle.pos);
    this.look = new THREE.Vector3(...SHOTS.idle.look);
    this.fov = SHOTS.idle.fov;
    this.roll = 0;
    this.trauma = 0;
    this.punch = new Spring(0, 140, 12);
    this.orbit = 0; // 0..1 blend into the orbiting title camera
    this.orbitAngle = 0;
    this.drift = 1;
    this.motionScale = 1; // lowered for prefers-reduced-motion
    this._tween = null;
    this._time = 0;
    this._from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 0, roll: 0 };
    this._to = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 0, roll: 0 };
    this._tmp = new THREE.Vector3();
    this._orbitPos = new THREE.Vector3();
  }

  shot(name, duration = 0.6, ease = Ease.inOutCubic) {
    const s = SHOTS[name];
    if (!s) return;
    this._from.pos.copy(this.pos);
    this._from.look.copy(this.look);
    this._from.fov = this.fov;
    this._from.roll = this.roll;
    this._to.pos.set(...s.pos);
    this._to.look.set(...s.look);
    this._to.fov = s.fov;
    this._to.roll = s.roll;
    if (duration <= 0) {
      this.pos.copy(this._to.pos);
      this.look.copy(this._to.look);
      this.fov = s.fov;
      this.roll = s.roll;
      this._tween = null;
      return;
    }
    this._tween = { t: 0, duration, ease };
  }

  shake(amount) {
    this.trauma = clamp(this.trauma + amount * this.motionScale, 0, 1);
  }

  kick(fovDelta) {
    this.punch.impulse(fovDelta);
  }

  update(dt, realDt) {
    this._time += realDt;
    const tw = this._tween;
    if (tw) {
      tw.t += dt;
      const e = tw.ease(Math.min(1, tw.t / tw.duration));
      this.pos.lerpVectors(this._from.pos, this._to.pos, e);
      this.look.lerpVectors(this._from.look, this._to.look, e);
      this.fov = this._from.fov + (this._to.fov - this._from.fov) * e;
      this.roll = this._from.roll + (this._to.roll - this._from.roll) * e;
      if (tw.t >= tw.duration) this._tween = null;
    }
    this.punch.update(realDt);
    this.trauma = Math.max(0, this.trauma - realDt * 1.5);

    const cam = this.camera;
    const t = this._time;
    const p = this._tmp.copy(this.pos);

    // Title orbit: swing around the stage center.
    if (this.orbit > 0.001) {
      this.orbitAngle += realDt * 0.13;
      const a = Math.sin(this.orbitAngle) * 0.75;
      const r = 7.4;
      const ox = Math.sin(a) * r;
      const oz = Math.cos(a) * r;
      p.lerp(this._orbitPos.set(ox, 2.6 + Math.sin(this.orbitAngle * 0.7) * 0.4, oz), this.orbit);
    }

    // Gentle hand-held drift.
    p.x += noise1(t * 0.35) * 0.06 * this.drift;
    p.y += noise1(t * 0.3 + 40) * 0.04 * this.drift;

    // Shake.
    const s = this.trauma * this.trauma;
    p.x += noise1(t * 28) * 0.22 * s;
    p.y += noise1(t * 28 + 70) * 0.16 * s;

    // Fit wider aspect ranges by widening the vertical FOV (keeps both hands in frame).
    const aspect = cam.aspect;
    let fov = this.fov + this.punch.value;
    if (aspect < DESIGN_ASPECT) {
      const halfH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * (DESIGN_ASPECT / Math.max(aspect, 0.5));
      fov = Math.min(80, THREE.MathUtils.radToDeg(Math.atan(halfH)) * 2);
    }

    cam.position.copy(p);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    cam.rotateZ(this.roll + noise1(t * 24 + 150) * 0.045 * s);
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
