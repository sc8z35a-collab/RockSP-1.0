import * as THREE from 'three';
import { Sparks } from './sparks.js';
import { Shards } from './shards.js';
import { Sprites } from './sprites.js';
import { Trail } from './trail.js';
import { rand } from '../core/math.js';

const WHITE = new THREE.Color(1, 1, 1);
const GOLD = new THREE.Color(1.0, 0.78, 0.35);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// High-level effect recipes built from particles, shards, sprites, trails,
// lights, camera and post-processing.
export class Effects {
  constructor(world, rig, core) {
    this.world = world;
    this.rig = rig;
    this.core = core;
    this.colorA = world.colorA;
    this.colorB = world.colorB;

    this.sparks = new Sparks(1800);
    this.shards = new Shards(96);
    this.sprites = new Sprites(world.camera);
    this.trails = [
      new Trail({ color: world.colorA, width: 0.32 }),
      new Trail({ color: world.colorB, width: 0.32 }),
    ];
    const scene = world.scene;
    scene.add(this.sparks.mesh, this.shards.mesh, this.sprites.group);
    for (const tr of this.trails) scene.add(tr.mesh);

    this.flash = 0;
    this.flashColor = new THREE.Color(1, 1, 1);
    this.aberration = 0;
    this.zoomBlur = 0;
    this.danger = 0;
    this.dangerTarget = 0;
    this.desaturate = 0;
    this.desaturateTarget = 0;
    this.exposure = 1;
    this.light = 0;
    this.lightColor = new THREE.Color(1, 1, 1);
    this.ambientTimer = 0;
    this.flashScale = 1; // lowered for prefers-reduced-motion
  }

  setBudget(scale) {
    this.sparks.budget = scale;
  }

  teamColor(side) {
    return side === 0 ? this.colorA : this.colorB;
  }

  clear() {
    this.sparks.clear();
    this.shards.clear();
    this.sprites.clear();
    for (const tr of this.trails) {
      tr.stop();
      tr.mesh.visible = false;
    }
    this.flash = 0;
    this.zoomBlur = 0;
    this.aberration = 0;
    this.light = 0;
  }

  screenFlash(amount, color = WHITE) {
    this.flash = Math.max(this.flash, amount * this.flashScale);
    this.flashColor.copy(color);
  }

  impactLight(pos, intensity, color = WHITE) {
    this.world.flashLight.position.copy(pos);
    this.world.flashLight.position.z += 0.8;
    this.light = Math.max(this.light, intensity);
    this.lightColor.copy(color);
  }

  zoomAt(pos, amount) {
    _v.copy(pos).project(this.world.camera);
    this.core.post.uZoomCenter.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    this.zoomBlur = Math.max(this.zoomBlur, amount);
  }

  // ---- Recipes ----

  // Chant beat ("じゃん", "けん"): neon pulse plus sparks rising off each fist.
  beat(level = 1) {
    this.world.arena.pulse = Math.min(1, 0.6 + level * 0.25);
    this.world.floor.uniforms.uCenterGlow.value = 0.4 * level;
    this.world.hands.forEach((hand, side) => {
      hand.palmCenter(_v);
      this.sparks.burst(_v, {
        count: 10 + level * 6,
        colors: [this.teamColor(side), WHITE],
        intensity: 3,
        speed: [1.0, 2.6],
        dir: _v2.set(0, 1, 0),
        spread: 0.9,
        life: [0.25, 0.5],
        size: [0.012, 0.03],
        gravity: 2,
        stretch: 0.05,
      });
    });
    this.rig.kick(-0.6 * level);
    this.rig.shake(0.06 + level * 0.04);
  }

  // Particles converging into a hand while it powers up.
  charge(side, strength = 1) {
    const hand = this.world.hands[side];
    hand.palmCenter(_v);
    this.sparks.implode(_v, {
      count: 16 * strength,
      colors: [this.teamColor(side), WHITE],
      radius: 1.1,
      strength: 34,
      swirl: 2.5,
      life: [0.3, 0.5],
      intensity: 2.5,
    });
  }

  // Both fists meet at the center.
  clash(point, draw = false) {
    const mix = this.colorA.clone().lerp(this.colorB, 0.5).lerp(WHITE, 0.4);
    this.sprites.flare(point, { color: mix, size: draw ? 1.9 : 2.3, dur: 0.32, intensity: 1.0 });
    this.sprites.ring(point, { color: WHITE, size: 3.4, dur: 0.45, intensity: 2.2, thickness: 0.06 });
    this.sprites.ring(point, { color: mix, size: 5.5, dur: 0.7, intensity: 1.2, thickness: 0.1, delay: 0.05 });
    this.sparks.burst(point, {
      count: draw ? 55 : 70,
      radius: 0.12,
      colors: [this.colorA, this.colorB, WHITE, GOLD],
      intensity: 2.6,
      speed: [3, 9],
      life: [0.3, 0.8],
      size: [0.012, 0.03],
      gravity: 7,
      stretch: 0.06,
      drag: 1.4,
    });
    this.world.floor.shockwave(point.x, point.z, { color: mix, maxR: 7, dur: 0.9, power: 1.4 });
    this.impactLight(point, 8);
    this.screenFlash(0.28);
    this.aberration = Math.max(this.aberration, 1.0);
    this.zoomAt(point, 0.35);
    this.rig.shake(0.45);
    this.rig.kick(4);
  }

  // Rock smashes scissors: armor shards, dust ring, heavy shake.
  crush(loserSide, winnerSide) {
    const loser = this.world.hands[loserSide];
    const win = this.teamColor(winnerSide);
    loser.palmCenter(_v);
    const away = _v2.set(loserSide === 0 ? -1 : 1, 0.35, 0.15).normalize();
    this.shards.burst(_v, {
      count: 26,
      dir: away,
      speed: [3, 7.5],
      color: loserSide === 0 ? 0xd6dde8 : 0x2a2229,
      glow: 1.6,
    });
    this.sparks.burst(_v, {
      count: 80,
      radius: 0.15,
      colors: [win, WHITE, GOLD],
      intensity: 2.6,
      speed: [3, 11],
      dir: away,
      spread: 1.1,
      life: [0.35, 0.9],
      size: [0.014, 0.035],
      gravity: 9,
      stretch: 0.06,
    });
    this.sprites.ring(_v, { color: win, size: 4.2, dur: 0.5, intensity: 2.6, thickness: 0.07, facing: 'x' });
    this.sprites.ring(_v, { color: WHITE, size: 2.6, dur: 0.35, intensity: 2.5, thickness: 0.05 });
    this.sprites.flare(_v, { color: win, size: 2.0, dur: 0.3, intensity: 1.0 });
    this.world.floor.shockwave(_v.x, _v.z, { color: win, maxR: 8, dur: 1.0, power: 2.0 });
    this.impactLight(_v, 22, win);
    this.screenFlash(0.38, win.clone().lerp(WHITE, 0.6));
    this.aberration = Math.max(this.aberration, 1.6);
    this.zoomAt(_v, 0.5);
    this.rig.shake(0.75);
    this.rig.kick(6);
  }

  // Scissors cut paper: an X of light sweeps across the loser.
  slash(loserSide, winnerSide) {
    const loser = this.world.hands[loserSide];
    const win = this.teamColor(winnerSide);
    loser.palmCenter(_v);
    _v.z += 0.4;
    const flip = loserSide === 0 ? -1 : 1;
    this.sprites.slash(_v, { color: win, size: 2.8, angle: 0.75 * flip, dur: 0.45 });
    this.sprites.slash(_v, { color: win, size: 2.8, angle: Math.PI - 0.75 * flip, dur: 0.45, delay: 0.09 });
    this.sparks.burst(_v, {
      count: 70,
      radius: 0.12,
      colors: [win, WHITE],
      intensity: 2.6,
      speed: [4, 12],
      life: [0.2, 0.6],
      size: [0.01, 0.026],
      gravity: 5,
      stretch: 0.09,
      flatten: new THREE.Vector3(1, 1, 0.3),
    });
    this.shards.burst(_v, { count: 12, speed: [2, 5], color: loserSide === 0 ? 0xd6dde8 : 0x2a2229, glow: 1.2 });
    this.sprites.flare(_v, { color: win, size: 1.7, dur: 0.25, intensity: 0.9 });
    this.world.floor.shockwave(_v.x, 0, { color: win, maxR: 5, dur: 0.7, power: 1.2 });
    this.impactLight(_v, 14, win);
    this.screenFlash(0.26, win.clone().lerp(WHITE, 0.7));
    this.aberration = Math.max(this.aberration, 1.3);
    this.rig.shake(0.5);
    this.rig.kick(3);
  }

  // Paper wraps rock: energy sphere engulfs the fist and collapses.
  wrap(loserSide, winnerSide) {
    const loser = this.world.hands[loserSide];
    const win = this.teamColor(winnerSide);
    const target = () => loser.palmCenter(new THREE.Vector3());
    this.sprites.wrapAround(target, { color: win, radius: 1.05, dur: 0.95 });
    loser.palmCenter(_v);
    this.sparks.implode(_v, {
      count: 60,
      colors: [win, WHITE],
      radius: 1.6,
      strength: 26,
      swirl: 5,
      life: [0.45, 0.8],
      intensity: 2.5,
    });
    this.impactLight(_v, 9, win);
    this.rig.shake(0.3);
  }

  // Final pop of the wrap (called when the sphere collapses).
  wrapBurst(loserSide, winnerSide) {
    const loser = this.world.hands[loserSide];
    const win = this.teamColor(winnerSide);
    loser.palmCenter(_v);
    this.sparks.burst(_v, {
      count: 75,
      radius: 0.18,
      colors: [win, WHITE],
      intensity: 2.6,
      speed: [3, 10],
      life: [0.3, 0.8],
      size: [0.012, 0.03],
      gravity: 4,
      stretch: 0.06,
    });
    this.sprites.ring(_v, { color: win, size: 4.6, dur: 0.55, intensity: 2.6, thickness: 0.08 });
    this.sprites.flare(_v, { color: win, size: 2.1, dur: 0.35, intensity: 1.0 });
    this.world.floor.shockwave(_v.x, _v.z, { color: win, maxR: 7, dur: 0.9, power: 1.8 });
    this.impactLight(_v, 20, win);
    this.screenFlash(0.34, win.clone().lerp(WHITE, 0.6));
    this.aberration = Math.max(this.aberration, 1.4);
    this.zoomAt(_v, 0.4);
    this.rig.shake(0.6);
    this.rig.kick(5);
  }

  // Draw: both hands repel with a cool white-blue burst.
  repel(point) {
    this.sparks.burst(point, {
      count: 60,
      colors: [WHITE, new THREE.Color(0.6, 0.8, 1.0)],
      intensity: 2.5,
      speed: [2, 7],
      life: [0.3, 0.7],
      size: [0.012, 0.028],
      gravity: 5,
      stretch: 0.05,
      flatten: new THREE.Vector3(0.4, 1, 1),
    });
    this.sprites.ring(point, { color: 0xcfe6ff, size: 3.2, dur: 0.5, intensity: 2, thickness: 0.06, facing: 'x' });
  }

  // Damage spark shower on a hand (used for the hit reaction).
  hitSparks(side, power = 1) {
    const hand = this.world.hands[side];
    hand.palmCenter(_v);
    this.sparks.burst(_v, {
      count: 40 * power,
      colors: [GOLD, WHITE, this.teamColor(side)],
      intensity: 2.6,
      speed: [2, 6],
      life: [0.4, 1.1],
      size: [0.01, 0.024],
      gravity: 9,
      stretch: 0.05,
      bounce: 0.4,
    });
  }

  // K.O. explosion.
  knockout(loserSide, winnerSide) {
    const loser = this.world.hands[loserSide];
    const win = this.teamColor(winnerSide);
    loser.palmCenter(_v);
    this.shards.burst(_v, {
      count: 50,
      speed: [3, 10],
      color: loserSide === 0 ? 0xd6dde8 : 0x2a2229,
      glow: 2.5,
      life: [2.5, 3.5],
    });
    this.sparks.burst(_v, {
      count: 130,
      radius: 0.25,
      colors: [win, WHITE, GOLD, this.teamColor(loserSide)],
      intensity: 2.3,
      speed: [3, 14],
      life: [0.5, 1.6],
      size: [0.014, 0.04],
      gravity: 8,
      stretch: 0.07,
      bounce: 0.45,
    });
    for (let i = 0; i < 3; i++) {
      this.sprites.ring(_v, {
        color: i === 1 ? WHITE : win,
        size: 4 + i * 2.5,
        dur: 0.6 + i * 0.2,
        intensity: 2.6 - i * 0.5,
        thickness: 0.08,
        facing: i === 2 ? 'x' : 'camera',
        delay: i * 0.08,
      });
    }
    this.sprites.flare(_v, { color: win, size: 3.0, dur: 0.6, intensity: 1.3 });
    this.world.floor.shockwave(_v.x, _v.z, { color: win, maxR: 12, dur: 1.4, power: 2.6 });
    this.world.floor.shockwave(_v.x, _v.z, { color: WHITE, maxR: 6, dur: 0.8, power: 1.5 });
    this.impactLight(_v, 14, win);
    this.screenFlash(0.42, WHITE);
    this.aberration = 2.2;
    this.zoomAt(_v, 0.6);
    this.rig.shake(1.0);
    this.rig.kick(9);
  }

  // Celebration fountain from the winning hand.
  celebrate(side) {
    const hand = this.world.hands[side];
    hand.palmCenter(_v);
    _v.y += 0.4;
    this.sparks.burst(_v, {
      count: 70,
      colors: [this.teamColor(side), WHITE, GOLD],
      intensity: 2.5,
      speed: [3, 7],
      dir: _v2.set(0, 1, 0),
      spread: 0.65,
      life: [0.8, 1.6],
      size: [0.015, 0.035],
      gravity: 5,
      drag: 1.0,
      stretch: 0.03,
      bounce: 0.3,
    });
  }

  startTrail(side) {
    const hand = this.world.hands[side];
    this.trails[side].start((t) => hand.frontPoint(t));
  }

  stopTrails() {
    for (const tr of this.trails) tr.stop();
  }

  update(dt, realDt, time) {
    this.sparks.update(dt);
    this.shards.update(dt);
    this.sprites.update(dt, time);
    for (const tr of this.trails) tr.update(dt, this.world.camera);

    // Post effects decay in real time so they still read during hit-stop.
    this.flash = Math.max(0, this.flash - realDt * 3.5);
    this.aberration = Math.max(0, this.aberration - realDt * 3.0);
    this.zoomBlur = Math.max(0, this.zoomBlur - realDt * 2.6);
    this.light = Math.max(0, this.light - realDt * 70);
    this.danger += (this.dangerTarget - this.danger) * Math.min(1, realDt * 3);
    this.desaturate += (this.desaturateTarget - this.desaturate) * Math.min(1, realDt * 2);
    const floorU = this.world.floor.uniforms;
    floorU.uCenterGlow.value = Math.max(0, floorU.uCenterGlow.value - dt * 1.5);

    if (this.core.bloomPass) this.core.bloomPass.strength = 0.6 + Math.min(0.25, this.flash * 0.4 + this.light * 0.006);
    const post = this.core.post;
    post.uFlash.value = this.flash * this.flash;
    post.uFlashColor.value.copy(this.flashColor);
    post.uAberration.value = 0.18 + this.aberration;
    post.uZoomBlur.value = this.zoomBlur;
    const pulse = 0.65 + 0.35 * Math.sin(time * 5.5);
    post.uDanger.value = this.danger * pulse * 0.32;
    post.uDesaturate.value = this.desaturate;
    post.uExposure.value = this.exposure;
    post.uTime.value = time;

    const fl = this.world.flashLight;
    fl.intensity = this.light;
    fl.color.copy(this.lightColor);

    // Ambient sparkle near the floor so the stage never feels static.
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = rand(0.08, 0.2);
      _v.set(rand(-5, 5), rand(0.05, 0.4), rand(-3, 1.5));
      this.sparks.burst(_v, {
        count: 1,
        colors: [_v.x < 0 ? this.colorA : this.colorB],
        intensity: 2.2,
        speed: [0.15, 0.5],
        dir: _v2.set(0, 1, 0),
        spread: 0.5,
        life: [1.2, 2.4],
        size: [0.008, 0.016],
        gravity: -0.25,
        drag: 0.3,
        stretch: 0.0,
        bounce: 0,
      });
    }
  }
}
