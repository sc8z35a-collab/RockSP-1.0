import * as THREE from 'three';
import { rand } from '../core/math.js';

const _m = new THREE.Matrix4();
const _dq = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// Physically bouncing armor fragments (one instanced draw call).
export class Shards {
  constructor(max = 90) {
    this.max = max;
    const geo = new THREE.TetrahedronGeometry(0.075, 0);
    geo.scale(1, 0.38, 1.7);
    geo.computeVertexNormals();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.55,
      roughness: 0.32,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.items = [];
    for (let i = 0; i < max; i++) {
      this.mesh.setColorAt(i, _c.set(1, 1, 1));
      this.items.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        axis: new THREE.Vector3(),
        spin: 0,
        life: 0,
        maxLife: 1,
        scale: 1,
        resting: false,
      });
    }
    this.cursor = 0;
  }

  burst(pos, { count = 24, dir = null, speed = [2.5, 6], color = 0xffffff, glow = 0, life = [1.4, 2.4], scale = [0.6, 1.4] } = {}) {
    const base = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const idx = this.cursor;
      const it = this.items[idx];
      this.cursor = (idx + 1) % this.max;
      it.alive = true;
      it.resting = false;
      it.pos.copy(pos).add(_p.set(rand(-0.15, 0.15), rand(-0.15, 0.15), rand(-0.15, 0.15)));
      it.vel.randomDirection();
      if (dir) it.vel.multiplyScalar(0.55).add(dir).normalize();
      it.vel.y = Math.abs(it.vel.y) * 0.8 + 0.25;
      it.vel.multiplyScalar(rand(speed[0], speed[1]));
      it.quat.random();
      it.axis.randomDirection();
      it.spin = rand(6, 18);
      it.life = it.maxLife = rand(life[0], life[1]);
      it.scale = rand(scale[0], scale[1]);
      _c.copy(base).multiplyScalar(rand(0.75, 1.1));
      this.mesh.setColorAt(idx, _c);
    }
    this.material.emissiveIntensity = glow;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    let maxIdx = 0;
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (!it.alive) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      maxIdx = i + 1;
      it.life -= dt;
      if (it.life <= 0) {
        it.alive = false;
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      if (!it.resting) {
        it.vel.y -= 13 * dt;
        it.vel.multiplyScalar(Math.exp(-0.6 * dt));
        it.pos.addScaledVector(it.vel, dt);
        if (it.pos.y < 0.03) {
          it.pos.y = 0.03;
          if (Math.abs(it.vel.y) < 0.8) {
            it.resting = true;
            it.vel.set(0, 0, 0);
          } else {
            it.vel.y *= -0.38;
            it.vel.x *= 0.55;
            it.vel.z *= 0.55;
            it.spin *= 0.5;
          }
        }
        _dq.setFromAxisAngle(it.axis, it.spin * dt);
        it.quat.premultiply(_dq);
      }
      const fade = Math.min(1, it.life / 0.35);
      _s.setScalar(it.scale * fade);
      _m.compose(it.pos, it.quat, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.material.emissiveIntensity = Math.max(0, this.material.emissiveIntensity - dt * 1.5);
    this.mesh.count = maxIdx;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const it of this.items) it.alive = false;
    this.mesh.count = 0;
  }
}
