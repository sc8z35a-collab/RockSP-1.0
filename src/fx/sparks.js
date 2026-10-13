import * as THREE from 'three';
import { rand } from '../core/math.js';

const vertexShader = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec4 iCol;
  attribute vec2 iSize;
  varying vec2 vUv;
  varying vec4 vCol;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    vec3 mvVel = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 dir = mvVel.xy;
    float speed = length(dir);
    dir = speed > 1e-4 ? dir / speed : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    float len = iSize.x + speed * iSize.y;
    mv.xy += dir * position.x * len + perp * position.y * iSize.x;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;
    vCol = iCol;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec4 vCol;
  void main() {
    float a = exp(-dot(vUv, vUv) * 3.2);
    gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.0);
  }
`;

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

// CPU-simulated additive particles rendered as velocity-stretched quads.
// Handles sparks, embers, energy motes and confetti-like bursts in one draw call.
export class Sparks {
  constructor(max = 1800) {
    this.max = max;
    this.count = 0;
    this.budget = 1; // quality scale for spawn counts
    const f = (n) => new Float32Array(max * n);
    this.p = f(3);
    this.v = f(3);
    this.col = f(3);
    this.life = f(1);
    this.maxLife = f(1);
    this.size = f(1);
    this.sizeEnd = f(1);
    this.stretch = f(1);
    this.gravity = f(1);
    this.drag = f(1);
    this.bounce = f(1);
    this.attract = f(4); // xyz target + strength

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const attr = (name, n) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.aPos = attr('iPos', 3);
    this.aVel = attr('iVel', 3);
    this.aCol = attr('iCol', 4);
    this.aSize = attr('iSize', 2);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  spawn(x, y, z, vx, vy, vz, o) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    const c = o.color;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.life[i] = this.maxLife[i] = o.life;
    this.size[i] = o.size;
    this.sizeEnd[i] = o.sizeEnd;
    this.stretch[i] = o.stretch;
    this.gravity[i] = o.gravity;
    this.drag[i] = o.drag;
    this.bounce[i] = o.bounce;
    this.attract[i * 4 + 3] = 0;
    if (o.attract) {
      this.attract[i * 4] = o.attract.x;
      this.attract[i * 4 + 1] = o.attract.y;
      this.attract[i * 4 + 2] = o.attract.z;
      this.attract[i * 4 + 3] = o.attractStrength || 0;
    }
  }

  /**
   * Emit a burst.
   * @param {THREE.Vector3} pos
   * @param {object} o
   *   count, speed [min,max], dir (Vector3) + spread (radians, cone) or sphere when no dir,
   *   colors (array of Color, random mix), intensity, life [min,max], size [min,max],
   *   sizeEnd (multiplier), stretch, gravity, drag, bounce, radius (spawn jitter), attract
   */
  burst(pos, o) {
    const count = Math.round((o.count || 20) * this.budget);
    const colors = o.colors || [new THREE.Color(1, 1, 1)];
    const intensity = o.intensity ?? 3;
    const speed = o.speed || [2, 6];
    const life = o.life || [0.4, 0.9];
    const size = o.size || [0.02, 0.05];
    const spread = o.spread ?? Math.PI;
    const radius = o.radius || 0;
    if (o.dir) _q.setFromUnitVectors(_up, _tmp.copy(o.dir).normalize());
    const opts = {
      color: _c1,
      life: 0,
      size: 0,
      sizeEnd: o.sizeEnd ?? 0.2,
      stretch: o.stretch ?? 0.04,
      gravity: o.gravity ?? 6,
      drag: o.drag ?? 1.5,
      bounce: o.bounce ?? 0.35,
      attract: o.attract,
      attractStrength: o.attractStrength,
    };
    for (let k = 0; k < count; k++) {
      if (o.dir) {
        // Random direction inside a cone around `dir`.
        const cosT = 1 - Math.random() * (1 - Math.cos(spread));
        const sinT = Math.sqrt(1 - cosT * cosT);
        const phi = Math.random() * Math.PI * 2;
        _dir.set(Math.cos(phi) * sinT, cosT, Math.sin(phi) * sinT).applyQuaternion(_q);
      } else {
        _dir.randomDirection();
        if (o.flatten) _dir.multiply(o.flatten).normalize();
      }
      const sp = rand(speed[0], speed[1]);
      const ca = colors[(Math.random() * colors.length) | 0];
      const cb = colors[(Math.random() * colors.length) | 0];
      _c1.copy(ca).lerp(_c2.copy(cb), Math.random()).multiplyScalar(intensity * rand(0.6, 1.2));
      opts.life = rand(life[0], life[1]);
      opts.size = rand(size[0], size[1]);
      const jx = radius ? (Math.random() - 0.5) * 2 * radius : 0;
      const jy = radius ? (Math.random() - 0.5) * 2 * radius : 0;
      const jz = radius ? (Math.random() - 0.5) * 2 * radius : 0;
      this.spawn(pos.x + jx, pos.y + jy, pos.z + jz, _dir.x * sp, _dir.y * sp, _dir.z * sp, opts);
    }
  }

  // Particles that start on a sphere and get pulled into `center` (charge-up effect).
  implode(center, o) {
    const count = Math.round((o.count || 24) * this.budget);
    const colors = o.colors;
    const R = o.radius || 1;
    const opts = {
      color: _c1,
      life: 0,
      size: 0,
      sizeEnd: 0.4,
      stretch: o.stretch ?? 0.08,
      gravity: 0,
      drag: 0.5,
      bounce: 0,
      attract: center,
      attractStrength: o.strength || 40,
    };
    for (let k = 0; k < count; k++) {
      _dir.randomDirection();
      const ca = colors[(Math.random() * colors.length) | 0];
      _c1.copy(ca).multiplyScalar((o.intensity ?? 3) * rand(0.6, 1.2));
      opts.life = rand(o.life?.[0] ?? 0.35, o.life?.[1] ?? 0.6);
      opts.size = rand(o.size?.[0] ?? 0.015, o.size?.[1] ?? 0.035);
      const r = R * rand(0.7, 1.2);
      // Tangential swirl.
      _tmp.set(-_dir.z, 0, _dir.x).multiplyScalar(o.swirl || 0);
      this.spawn(center.x + _dir.x * r, center.y + _dir.y * r, center.z + _dir.z * r, _tmp.x, _tmp.y, _tmp.z, opts);
    }
  }

  clear() {
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  update(dt) {
    let n = this.count;
    const { p, v, life } = this;
    if (dt > 0) {
      for (let i = 0; i < n; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {
          n--;
          this._move(n, i);
          i--;
          continue;
        }
        const i3 = i * 3;
        const at = this.attract[i * 4 + 3];
        if (at > 0) {
          const dx = this.attract[i * 4] - p[i3];
          const dy = this.attract[i * 4 + 1] - p[i3 + 1];
          const dz = this.attract[i * 4 + 2] - p[i3 + 2];
          v[i3] += dx * at * dt;
          v[i3 + 1] += dy * at * dt;
          v[i3 + 2] += dz * at * dt;
        }
        v[i3 + 1] -= this.gravity[i] * dt;
        const drag = Math.exp(-this.drag[i] * dt);
        v[i3] *= drag;
        v[i3 + 1] *= drag;
        v[i3 + 2] *= drag;
        p[i3] += v[i3] * dt;
        p[i3 + 1] += v[i3 + 1] * dt;
        p[i3 + 2] += v[i3 + 2] * dt;
        if (p[i3 + 1] < 0.015 && v[i3 + 1] < 0 && this.bounce[i] > 0) {
          p[i3 + 1] = 0.015;
          v[i3 + 1] *= -this.bounce[i];
          v[i3] *= 0.7;
          v[i3 + 2] *= 0.7;
        }
      }
      this.count = n;
    }

    const aP = this.aPos.array;
    const aV = this.aVel.array;
    const aC = this.aCol.array;
    const aS = this.aSize.array;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const t = 1 - life[i] / this.maxLife[i];
      aP[i3] = p[i3];
      aP[i3 + 1] = p[i3 + 1];
      aP[i3 + 2] = p[i3 + 2];
      aV[i3] = v[i3];
      aV[i3 + 1] = v[i3 + 1];
      aV[i3 + 2] = v[i3 + 2];
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      aC[i * 4] = this.col[i3];
      aC[i * 4 + 1] = this.col[i3 + 1];
      aC[i * 4 + 2] = this.col[i3 + 2];
      aC[i * 4 + 3] = fade * fade;
      aS[i * 2] = this.size[i] * (1 + (this.sizeEnd[i] - 1) * t);
      aS[i * 2 + 1] = this.stretch[i];
    }
    this.geometry.instanceCount = n;
    if (n > 0) {
      for (const a of [this.aPos, this.aVel, this.aCol, this.aSize]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  // Move particle `from` into slot `to` (swap-remove).
  _move(from, to) {
    if (from === to) return;
    const c3 = (arr) => {
      arr[to * 3] = arr[from * 3];
      arr[to * 3 + 1] = arr[from * 3 + 1];
      arr[to * 3 + 2] = arr[from * 3 + 2];
    };
    c3(this.p);
    c3(this.v);
    c3(this.col);
    for (const arr of [this.life, this.maxLife, this.size, this.sizeEnd, this.stretch, this.gravity, this.drag, this.bounce]) {
      arr[to] = arr[from];
    }
    for (let k = 0; k < 4; k++) this.attract[to * 4 + k] = this.attract[from * 4 + k];
  }
}
