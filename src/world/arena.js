import * as THREE from 'three';
import { LAYER_MAIN_ONLY } from './floor.js';

const TAU = Math.PI * 2;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uTime;
  uniform float uEnergy;
  varying vec3 vDir;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i), n100 = hash31(i + vec3(1, 0, 0));
    float n010 = hash31(i + vec3(0, 1, 0)), n110 = hash31(i + vec3(1, 1, 0));
    float n001 = hash31(i + vec3(0, 0, 1)), n101 = hash31(i + vec3(1, 0, 1));
    float n011 = hash31(i + vec3(0, 1, 1)), n111 = hash31(i + vec3(1, 1, 1));
    return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
               mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sx = smoothstep(-0.75, 0.75, d.x);
    vec3 team = mix(uColA, uColB, sx);

    vec3 zenith = vec3(0.0025, 0.003, 0.009);
    vec3 horizon = team * (0.07 + 0.05 * uEnergy) + vec3(0.012, 0.01, 0.024);
    float band = exp(-max(h, 0.0) * 6.0);
    vec3 col = mix(zenith, horizon, band);
    col = mix(col, vec3(0.004, 0.004, 0.009), smoothstep(0.0, -0.2, h));

    float n = noise3(d * 2.2 + vec3(uTime * 0.01, 0.0, 0.0)) * 0.62
            + noise3(d * 4.7 - vec3(0.0, uTime * 0.013, 0.0)) * 0.28
            + noise3(d * 9.5) * 0.1;
    float neb = pow(max(n - 0.32, 0.0) * 1.6, 2.2);
    col += team * neb * 0.09 * smoothstep(-0.02, 0.35, h);

    vec3 sp = d * 170.0;
    vec3 id = floor(sp);
    float rnd = hash31(id);
    float star = smoothstep(0.17, 0.0, length(fract(sp) - 0.5)) * step(0.982, rnd);
    star *= 0.55 + 0.45 * sin(uTime * (0.8 + rnd * 3.0) + rnd * 60.0);
    col += vec3(0.75, 0.85, 1.0) * star * 1.6 * smoothstep(0.03, 0.25, h);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const gradientVertex = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec2 vUv;
  void main() {
    vLocal = position;
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Big neon gate ring behind the stage: color follows the angle, with moving dashes.
const ringFragment = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uTime;
  uniform float uIntensity;
  uniform float uDash;
  uniform float uSpeed;
  varying vec3 vLocal;
  void main() {
    float ang = atan(vLocal.y, vLocal.x);
    float sx = smoothstep(-0.9, 0.9, -cos(ang + 3.14159));
    vec3 team = mix(uColA, uColB, sx);
    vec3 col = mix(team, vec3(1.0), smoothstep(0.6, 1.0, sin(ang)) * 0.55);
    float dashes = uDash > 0.0 ? step(0.5, fract(ang / 6.28318 * uDash + uTime * uSpeed)) : 1.0;
    gl_FragColor = vec4(col * uIntensity * dashes, 1.0);
  }
`;

const membraneFragment = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uTime;
  uniform float uEnergy;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float swirl = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - uTime * 1.3);
    float swirl2 = 0.5 + 0.5 * sin(-a * 5.0 + r * 14.0 - uTime * 0.9);
    vec3 team = mix(uColA, uColB, smoothstep(-0.8, 0.8, p.x));
    float body = smoothstep(1.0, 0.2, r);
    float core = exp(-r * r * 9.0);
    vec3 col = team * body * (0.03 + 0.05 * swirl * swirl2) * (0.6 + uEnergy);
    col += mix(team, vec3(1.0), 0.6) * core * (0.08 + 0.35 * uEnergy);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const coneFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec2 vUv;
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float facing = abs(dot(normalize(vNormalW), V));
    float soft = pow(facing, 2.0);
    float along = vUv.y;                       // 0 at the floor, 1 at the lamp
    float fade = smoothstep(0.0, 0.25, along) * (0.35 + 0.65 * along);
    gl_FragColor = vec4(uColor * soft * fade * uIntensity, 1.0);
  }
`;

const dustVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAlpha;
  varying float vSide;
  void main() {
    vec3 p = position;
    float t = uTime * (0.08 + aSeed.x * 0.12);
    p.y = mod(p.y + t * 4.0, 7.0);
    p.x += sin(uTime * 0.3 + aSeed.y * 6.28) * 0.35;
    p.z += cos(uTime * 0.25 + aSeed.z * 6.28) * 0.35;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (2.0 + aSeed.w * 4.0) * uPixelRatio * (6.0 / max(0.5, -mv.z));
    vAlpha = smoothstep(0.0, 0.8, p.y) * smoothstep(7.0, 5.5, p.y) * (0.7 + 0.3 * sin(uTime * 2.0 + aSeed.w * 40.0));
    vSide = p.x;
  }
`;

const dustFragment = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  varying float vAlpha;
  varying float vSide;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    float a = exp(-d * 3.0) * vAlpha;
    vec3 col = mix(uColA, uColB, smoothstep(-3.0, 3.0, vSide));
    col = mix(col, vec3(1.0), 0.35);
    gl_FragColor = vec4(col * a * 0.9, 1.0);
  }
`;

const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec2 vUv;
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float facing = pow(abs(dot(normalize(vNormalW), V)), 3.0);
    float along = vUv.y;
    float fade = smoothstep(0.0, 0.15, along) * smoothstep(1.0, 0.35, along);
    gl_FragColor = vec4(uColor * facing * fade * uIntensity, 1.0);
  }
`;

function additive(uniforms, vertexShader, fragmentShader, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    ...extra,
  });
}

// The stage surroundings: sky dome, neon gate, light pillars, spotlight cones,
// search beams, background towers and floating dust.
export class Arena {
  constructor({ colorA, colorB }) {
    this.group = new THREE.Group();
    this.colorA = new THREE.Color(colorA);
    this.colorB = new THREE.Color(colorB);
    this.energy = 0;
    this.pulse = 0;
    this.time = 0;
    this.materials = [];
    this.coneMats = [];
    this.beams = [];

    this._sky();
    this._gate();
    this._pillars();
    this._towers();
    this._cones();
    this._beams();
    this._dust();
  }

  _sky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uColA: { value: this.colorA },
        uColB: { value: this.colorB },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), this.skyMat);
    sky.layers.set(LAYER_MAIN_ONLY);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.group.add(sky);
  }

  _gate() {
    const gate = new THREE.Group();
    gate.position.set(0, 2.35, -8.6);
    gate.scale.setScalar(0.8);
    this.gate = gate;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x151824, metalness: 0.9, roughness: 0.35 });
    const frame = new THREE.Mesh(new THREE.TorusGeometry(4.55, 0.24, 16, 120), frameMat);
    gate.add(frame);

    const mkRing = (radius, tube, intensity, dash, speed) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColA: { value: this.colorA },
          uColB: { value: this.colorB },
          uTime: { value: 0 },
          uIntensity: { value: intensity },
          uDash: { value: dash },
          uSpeed: { value: speed },
        },
        vertexShader: gradientVertex,
        fragmentShader: ringFragment,
        fog: false,
      });
      this.materials.push(mat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 160), mat);
      gate.add(ring);
      return ring;
    };
    this.gateMain = mkRing(4.3, 0.045, 3.2, 0, 0);
    this.gateDash = mkRing(3.95, 0.03, 2.4, 48, 0.05);
    this.gateOuter = mkRing(4.82, 0.022, 1.6, 120, -0.03);

    // Nodes around the frame.
    const nodeGeo = new THREE.SphereGeometry(0.11, 12, 8);
    const nodeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3) });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const n = new THREE.Mesh(nodeGeo, nodeMat);
      n.position.set(Math.cos(a) * 4.55, Math.sin(a) * 4.55, 0.22);
      gate.add(n);
    }

    this.membraneMat = additive(
      {
        uColA: { value: this.colorA },
        uColB: { value: this.colorB },
        uTime: { value: 0 },
        uEnergy: { value: 0 },
      },
      gradientVertex,
      membraneFragment
    );
    const membrane = new THREE.Mesh(new THREE.CircleGeometry(4.3, 64), this.membraneMat);
    membrane.position.z = -0.05;
    gate.add(membrane);

    // Gate pedestal.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 0.5, 6), frameMat);
    base.position.set(0, -2.35 / 0.8 + 0.25, 0);
    gate.add(base);

    this.group.add(gate);
  }

  _pillars() {
    const count = 14;
    const geo = new THREE.BoxGeometry(0.11, 1, 0.11);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bars = new THREE.InstancedMesh(geo, mat, count);
    const baseGeo = new THREE.CylinderGeometry(0.35, 0.5, 0.5, 8);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x10131c, metalness: 0.8, roughness: 0.4 });
    const bases = new THREE.InstancedMesh(baseGeo, baseMat, count);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    this.pillarInfo = [];
    for (let i = 0; i < count; i++) {
      // Two arcs on the back-left and back-right, leaving the center (behind the gate) clear.
      const half = count / 2;
      const k = i % half;
      const a = i < half ? Math.PI * (1.0 + (k / (half - 1)) * 0.36) : Math.PI * (2.0 - (k / (half - 1)) * 0.36);
      const R = 12.5;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R * 0.85 - 1.5;
      const h = 7 + Math.sin(i * 1.7) * 1.5;
      m.makeScale(1, h, 1).setPosition(x, h / 2 + 0.4, z);
      bars.setMatrixAt(i, m);
      m.makeTranslation(x, 0.25, z);
      bases.setMatrixAt(i, m);
      const side = x < -0.5 ? 0 : x > 0.5 ? 1 : 0.5;
      c.copy(this.colorA).lerp(this.colorB, side).multiplyScalar(2.6);
      bars.setColorAt(i, c);
      this.pillarInfo.push({ side, base: c.clone() });
    }
    bars.instanceColor.needsUpdate = true;
    this.pillars = bars;
    this.group.add(bars, bases);
  }

  _towers() {
    const count = 26;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a0c13, metalness: 0.7, roughness: 0.55 });
    const towers = new THREE.InstancedMesh(geo, mat, count);
    const stripGeo = new THREE.BoxGeometry(1, 1, 1);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const strips = new THREE.InstancedMesh(stripGeo, stripMat, count * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    let si = 0;
    for (let i = 0; i < count; i++) {
      const a = Math.PI * 1.02 + (i / (count - 1)) * Math.PI * 0.96;
      const R = 24 + (i % 3) * 3.5;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R - 2;
      const w = 1.6 + (i % 4) * 0.7;
      const h = 6 + ((i * 7) % 5) * 2.6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
      m.compose(p.set(x, h / 2, z), q, s.set(w, h, w * 0.8));
      towers.setMatrixAt(i, m);
      const side = x < 0 ? 0 : 1;
      c.copy(side ? this.colorB : this.colorA).multiplyScalar(1.6);
      for (let k = 0; k < 2; k++) {
        const yy = k === 0 ? h * 0.98 : h * (0.35 + ((i * 3) % 4) * 0.12);
        m.compose(p.set(x, yy, z), q, s.set(w * 1.02, 0.06, w * 0.82));
        strips.setMatrixAt(si, m);
        strips.setColorAt(si, c);
        si++;
      }
    }
    strips.instanceColor.needsUpdate = true;
    this.group.add(towers, strips);

    // Stadium wall ring.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x07080d, metalness: 0.6, roughness: 0.6, side: THREE.BackSide });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 1.6, 96, 1, true), wallMat);
    wall.position.y = 0.8;
    this.group.add(wall);
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(15.95, 0.035, 6, 200),
      new THREE.ShaderMaterial({
        uniforms: {
          uColA: { value: this.colorA },
          uColB: { value: this.colorB },
          uTime: { value: 0 },
          uIntensity: { value: 0.55 },
          uDash: { value: 0 },
          uSpeed: { value: 0 },
        },
        vertexShader: gradientVertex,
        fragmentShader: ringFragment,
        fog: false,
      })
    );
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 1.6;
    this.group.add(lip);
  }

  _cones() {
    // Cylinder UVs run v=0 at the floor end to v=1 at the lamp end.
    const geo = new THREE.CylinderGeometry(0.08, 1.7, 7.5, 40, 1, true);
    for (const [i, side] of [
      [0, -1],
      [1, 1],
    ]) {
      const mat = additive(
        {
          uColor: { value: (i === 0 ? this.colorA : this.colorB).clone().lerp(new THREE.Color(1, 1, 1), 0.35) },
          uIntensity: { value: 0.11 },
        },
        gradientVertex,
        coneFragment,
        { side: THREE.DoubleSide }
      );
      this.coneMats.push(mat);
      const cone = new THREE.Mesh(geo, mat);
      cone.position.set(side * 2.75, 3.75, -0.1);
      cone.layers.set(LAYER_MAIN_ONLY);
      this.group.add(cone);
    }
  }

  _beams() {
    const geo = new THREE.CylinderGeometry(0.9, 0.05, 30, 24, 1, true);
    geo.translate(0, 15, 0);
    const spots = [
      [-14, -6, 0],
      [-9, -12, 0],
      [9, -12, 1],
      [14, -6, 1],
    ];
    for (const [x, z, side] of spots) {
      const mat = additive(
        {
          uColor: { value: (side ? this.colorB : this.colorA).clone() },
          uIntensity: { value: 0.14 },
        },
        gradientVertex,
        beamFragment,
        { side: THREE.DoubleSide }
      );
      const beam = new THREE.Mesh(geo, mat);
      beam.position.set(x, 0, z);
      beam.layers.set(LAYER_MAIN_ONLY);
      this.beams.push({ mesh: beam, phase: Math.random() * TAU, side, mat });
      this.group.add(beam);
    }
  }

  _dust() {
    const count = 520;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 18;
      pos[i * 3 + 1] = Math.random() * 7;
      pos[i * 3 + 2] = -9 + Math.random() * 13;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.dustMat = additive(
      {
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uColA: { value: this.colorA },
        uColB: { value: this.colorB },
      },
      dustVertex,
      dustFragment
    );
    const dust = new THREE.Points(geo, this.dustMat);
    dust.frustumCulled = false;
    dust.layers.set(LAYER_MAIN_ONLY);
    this.group.add(dust);
  }

  setPixelRatio(pr) {
    this.dustMat.uniforms.uPixelRatio.value = pr;
  }

  // `pulse` 0..1 flashes the neon on beats; `energy` 0..1 raises overall intensity.
  update(dt, t) {
    this.time = t;
    this.pulse = Math.max(0, this.pulse - dt * 2.8);
    const e = this.energy;
    this.skyMat.uniforms.uTime.value = t;
    this.skyMat.uniforms.uEnergy.value = e * 0.6 + this.pulse * 0.3;
    this.dustMat.uniforms.uTime.value = t;
    this.membraneMat.uniforms.uTime.value = t;
    this.membraneMat.uniforms.uEnergy.value = e * 0.4 + this.pulse * 0.5;
    for (const m of this.materials) m.uniforms.uTime.value = t;
    this.gateMain.material.uniforms.uIntensity.value = 3.0 + this.pulse * 2 + e * 0.8;
    this.gateDash.rotation.z = t * 0.12;
    this.gateOuter.rotation.z = -t * 0.05;
    for (const cm of this.coneMats) cm.uniforms.uIntensity.value = 0.09 + this.pulse * 0.04 + e * 0.02;

    for (const b of this.beams) {
      const sway = Math.sin(t * 0.35 + b.phase);
      b.mesh.rotation.z = (b.side ? 1 : -1) * (0.25 + sway * 0.22);
      b.mesh.rotation.x = -0.25 + Math.cos(t * 0.27 + b.phase) * 0.12;
      b.mat.uniforms.uIntensity.value = 0.12 + e * 0.05 + this.pulse * 0.06;
    }

    const c = this._tmpColor || (this._tmpColor = new THREE.Color());
    const boost = 1 + this.pulse * 0.5 + e * 0.25;
    this.pillarInfo.forEach((p, i) => {
      const flick = 0.85 + 0.15 * Math.sin(t * 3.0 + i * 1.3);
      c.copy(p.base).multiplyScalar(boost * flick);
      this.pillars.setColorAt(i, c);
    });
    this.pillars.instanceColor.needsUpdate = true;
  }
}
