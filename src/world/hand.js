import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { Spring, noise1 } from '../core/math.js';

// Procedural, rigidly skinned robot hand.
//
// Local rig space: wrist at the origin, fingers point +Y, the back of the hand
// faces +Z, the palm faces -Z and the thumb sits on the -X side (right hand).
// Every part is merged into three skinned meshes (armor / metal / glow), so a
// whole hand costs three draw calls while all 17 joints still animate.

const FINGERS = [
  { x: -0.305, y: 0.93, len: [0.42, 0.27, 0.22], r: 0.1 }, // index
  { x: -0.1, y: 0.975, len: [0.46, 0.3, 0.23], r: 0.104 }, // middle
  { x: 0.11, y: 0.945, len: [0.43, 0.28, 0.22], r: 0.099 }, // ring
  { x: 0.31, y: 0.86, len: [0.34, 0.22, 0.19], r: 0.088 }, // pinky
];
const THUMB = { x: -0.39, y: 0.2, z: -0.05, len: [0.3, 0.27, 0.23], r: 0.112 };

// Pose format: fingers [spread, curl0, curl1, curl2]; thumb [rx, ry, rz, curl1, curl2]; wrist [rx, rz].
export const POSES = {
  relaxed: {
    fingers: [
      [0.07, 0.28, 0.38, 0.24],
      [0.02, 0.32, 0.42, 0.26],
      [-0.05, 0.38, 0.48, 0.28],
      [-0.12, 0.44, 0.54, 0.3],
    ],
    thumb: [-0.45, -0.45, 0.5, 0.18, 0.22],
    wrist: [0, 0],
  },
  rock: {
    fingers: [
      [0.03, 1.5, 1.78, 1.05],
      [0.0, 1.55, 1.78, 1.05],
      [-0.03, 1.55, 1.72, 1.02],
      [-0.07, 1.5, 1.66, 1.0],
    ],
    thumb: [-1.0, -1.0, 0.24, 0.5, 0.62],
    wrist: [0, 0],
  },
  scissors: {
    fingers: [
      [0.2, 0.02, 0.03, 0.02],
      [-0.15, 0.02, 0.03, 0.02],
      [-0.03, 1.55, 1.72, 1.02],
      [-0.07, 1.5, 1.66, 1.0],
    ],
    thumb: [-1.05, -1.2, 0.12, 0.58, 0.66],
    wrist: [0, 0],
  },
  paper: {
    fingers: [
      [0.17, 0.05, 0.04, 0.02],
      [0.03, 0.03, 0.03, 0.02],
      [-0.11, 0.05, 0.04, 0.02],
      [-0.26, 0.09, 0.07, 0.04],
    ],
    thumb: [-0.25, -0.35, 0.82, 0.08, 0.1],
    wrist: [0, 0],
  },
};

const NUM_BONES = 17;
const BONE_ARM = 0;
const BONE_WRIST = 1;
const fingerBone = (f, s) => 2 + f * 3 + s;
const thumbBone = (s) => 14 + s;

const TEAM_STYLE = {
  p1: {
    armor: { color: 0xc9d2de, metalness: 0.08, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.2 },
    metal: { color: 0x394050, metalness: 1, roughness: 0.32 },
  },
  p2: {
    armor: { color: 0x221a20, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18 },
    metal: { color: 0x2c2a30, metalness: 1, roughness: 0.3 },
  },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function localMatrix(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
}

// Flat shape with rounded corners from a list of [x, y] points (counter-clockwise).
function roundedPolygon(points, r) {
  const pts = points.map(([x, y]) => new THREE.Vector2(x, y));
  const shape = new THREE.Shape();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const d1 = p1.clone().sub(p0).normalize();
    const d2 = p2.clone().sub(p1).normalize();
    const a = p1.clone().sub(d1.multiplyScalar(r));
    const b = p1.clone().add(d2.multiplyScalar(r));
    if (i === 0) shape.moveTo(a.x, a.y);
    else shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(p1.x, p1.y, b.x, b.y);
  }
  shape.closePath();
  return shape;
}

// Beveled slab extruded from a rounded polygon, centered on z = 0.
function slab(points, radius, depth, bevel) {
  const geo = new THREE.ExtrudeGeometry(roundedPolygon(points, radius), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 5,
  });
  geo.translate(0, 0, -depth / 2);
  geo.deleteAttribute('uv');
  return toCreasedNormals(geo, Math.PI / 4.5);
}

function prepGeometry(geo) {
  let g = geo;
  if (!g.index) {
    const idx = [];
    for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
    g.setIndex(idx);
  }
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

function buildRig() {
  const bones = [];
  const arm = new THREE.Bone();
  arm.name = 'arm';
  bones.push(arm);
  const wrist = new THREE.Bone();
  wrist.name = 'wrist';
  wrist.rotation.order = 'ZXY';
  arm.add(wrist);
  bones.push(wrist);

  FINGERS.forEach((f, fi) => {
    let parent = wrist;
    for (let s = 0; s < 3; s++) {
      const b = new THREE.Bone();
      b.name = `f${fi}_${s}`;
      if (s === 0) {
        b.position.set(f.x, f.y, 0);
        b.rotation.order = 'ZXY';
      } else {
        b.position.set(0, f.len[s - 1], 0);
      }
      parent.add(b);
      bones.push(b);
      parent = b;
    }
  });

  let parent = wrist;
  for (let s = 0; s < 3; s++) {
    const b = new THREE.Bone();
    b.name = `t_${s}`;
    if (s === 0) {
      b.position.set(THUMB.x, THUMB.y, THUMB.z);
      b.rotation.order = 'ZXY';
    } else {
      b.position.set(0, THUMB.len[s - 1], 0);
    }
    parent.add(b);
    bones.push(b);
    parent = b;
  }
  arm.updateMatrixWorld(true);
  return bones;
}

// Builds the three merged geometries (armor / metal / glow) in bind pose.
function buildGeometries(bones) {
  const parts = { armor: [], metal: [], glow: [] };

  const add = (kind, geo, bone, pos, rot, scale) => {
    const g = prepGeometry(geo);
    _m.copy(bones[bone].matrixWorld).multiply(localMatrix(pos, rot, scale));
    g.applyMatrix4(_m);
    const count = g.attributes.position.count;
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      si[i * 4] = bone;
      sw[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    parts[kind].push(g);
  };
  const rbox = (w, h, d, r, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);
  const HALF_PI = Math.PI / 2;

  // ---- Forearm & wrist (arm bone) ----
  const lathePts = [
    [0.0, -0.08],
    [0.305, -0.08],
    [0.35, -0.3],
    [0.4, -0.75],
    [0.42, -1.3],
    [0.405, -2.0],
    [0.39, -3.1],
    [0.0, -3.1],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  add('armor', new THREE.LatheGeometry(lathePts.slice().reverse(), 40), BONE_ARM, [0, 0, 0], [0, 0, 0], [1.12, 1, 0.9]);
  add('metal', new THREE.CylinderGeometry(0.27, 0.3, 0.2, 32), BONE_ARM, [0, -0.04, 0]);
  add('glow', new THREE.TorusGeometry(0.305, 0.02, 8, 56), BONE_ARM, [0, -0.03, 0], [HALF_PI, 0, 0]);
  add('glow', new THREE.TorusGeometry(0.378, 0.014, 6, 56), BONE_ARM, [0, -0.55, 0], [HALF_PI, 0, 0], [1.125, 0.905, 1]);
  add('glow', new THREE.TorusGeometry(0.413, 0.014, 6, 56), BONE_ARM, [0, -1.75, 0], [HALF_PI, 0, 0], [1.125, 0.905, 1]);
  add('armor', rbox(0.48, 1.3, 0.12, 0.05), BONE_ARM, [0, -1.15, 0.375], [-0.015, 0, 0]);
  add('glow', new THREE.BoxGeometry(0.035, 1.02, 0.014), BONE_ARM, [0, -1.15, 0.44], [-0.015, 0, 0]);
  add('metal', rbox(0.08, 0.7, 0.2, 0.03), BONE_ARM, [0.47, -1.1, 0.05]);
  add('metal', rbox(0.08, 0.7, 0.2, 0.03), BONE_ARM, [-0.47, -1.1, 0.05]);

  // ---- Palm (wrist bone) ----
  // Tapered core: narrow at the wrist, wide at the knuckles.
  add('metal', slab([[-0.33, 0.02], [0.33, 0.02], [0.42, 0.95], [-0.42, 0.95]], 0.1, 0.2, 0.045), BONE_WRIST, [0, 0, -0.02]);
  // Back armor plate (two layers for a machined look).
  add('armor', slab([[-0.36, 0.07], [0.36, 0.07], [0.44, 0.76], [-0.44, 0.76]], 0.09, 0.07, 0.035), BONE_WRIST, [0, 0, 0.115], [0.035, 0, 0]);
  add('armor', slab([[-0.24, 0.2], [0.24, 0.2], [0.29, 0.62], [-0.29, 0.62]], 0.07, 0.03, 0.02), BONE_WRIST, [0, 0, 0.185], [0.035, 0, 0]);
  add('armor', rbox(0.95, 0.2, 0.16, 0.07), BONE_WRIST, [0, 0.855, 0.105], [-0.12, 0, 0]);
  add('armor', rbox(0.13, 0.5, 0.3, 0.055), BONE_WRIST, [-0.425, 0.34, 0]);
  add('armor', rbox(0.1, 0.6, 0.26, 0.045), BONE_WRIST, [0.445, 0.47, 0], [0, 0, -0.08]);
  add('metal', slab([[-0.28, 0.12], [0.28, 0.12], [0.36, 0.86], [-0.36, 0.86]], 0.07, 0.03, 0.02), BONE_WRIST, [0, 0, -0.16]);
  add('metal', new THREE.CylinderGeometry(0.15, 0.15, 0.03, 6), BONE_WRIST, [0, 0.41, 0.232], [HALF_PI, 0, 0]);
  add('glow', new THREE.CylinderGeometry(0.095, 0.095, 0.03, 6), BONE_WRIST, [0, 0.41, 0.244], [HALF_PI, 0, 0]);
  add('glow', new THREE.BoxGeometry(0.018, 0.4, 0.012), BONE_WRIST, [-0.345, 0.42, 0.2], [0.035, 0, -0.06]);
  add('glow', new THREE.BoxGeometry(0.018, 0.4, 0.012), BONE_WRIST, [0.345, 0.42, 0.2], [0.035, 0, 0.06]);
  add('glow', new THREE.BoxGeometry(0.66, 0.016, 0.012), BONE_WRIST, [0, 0.865, 0.19], [-0.12, 0, 0]);
  add('glow', new THREE.CylinderGeometry(0.11, 0.11, 0.02, 24), BONE_WRIST, [0, 0.5, -0.2], [HALF_PI, 0, 0]);

  // ---- Fingers ----
  const segment = (bone, L, rs, s, isThumb) => {
    add('metal', new THREE.CapsuleGeometry(rs * 0.82, Math.max(0.01, L - rs * 1.1), 4, 14), bone, [0, L / 2, 0]);
    add('metal', new THREE.SphereGeometry(rs * (s === 0 ? 1.02 : 0.92), 16, 12), bone, [0, 0, 0]);
    const top = rs * 0.28 + rs * 0.68;
    if (s < 2) {
      add('armor', rbox(rs * 2.1, L * 0.82, rs * 1.36, rs * 0.46), bone, [0, L * 0.53, rs * 0.28]);
      if (s === 0) add('glow', new THREE.BoxGeometry(0.018, L * 0.46, 0.012), bone, [0, L * 0.53, top + 0.002]);
      else if (!isThumb) add('glow', new THREE.BoxGeometry(rs * 1.25, 0.013, 0.012), bone, [0, L * 0.88, top - 0.012]);
    } else {
      // Fingertip: rounded shell with a glowing nail.
      add('armor', rbox(rs * 2.0, L * 0.86, rs * 1.34, rs * 0.62), bone, [0, L * 0.5, rs * 0.22]);
      add('glow', rbox(rs * 0.95, L * 0.22, 0.02, 0.008, 2), bone, [0, L * 0.7, top - 0.02]);
      add('metal', new THREE.SphereGeometry(rs * 0.8, 14, 10), bone, [0, L * 0.62, -rs * 0.3]);
    }
  };

  FINGERS.forEach((f, fi) => {
    for (let s = 0; s < 3; s++) segment(fingerBone(fi, s), f.len[s], f.r * (1 - 0.07 * s), s, false);
  });

  // ---- Thumb ----
  const t0 = thumbBone(0);
  add('metal', new THREE.SphereGeometry(0.135, 16, 12), t0, [0, 0, 0]);
  add('metal', new THREE.CapsuleGeometry(0.095, 0.2, 4, 14), t0, [0, 0.16, 0]);
  add('armor', rbox(0.25, 0.29, 0.18, 0.065), t0, [0, 0.16, 0.035]);
  add('glow', new THREE.BoxGeometry(0.018, 0.17, 0.012), t0, [0, 0.16, 0.13]);
  for (let s = 1; s < 3; s++) segment(thumbBone(s), THUMB.len[s], THUMB.r * (1 - 0.08 * s), s, true);

  const out = {};
  for (const k of Object.keys(parts)) {
    out[k] = mergeGeometries(parts[k], false);
    for (const g of parts[k]) g.dispose();
  }
  return out;
}

let SHARED = null;
function sharedGeometry() {
  if (!SHARED) SHARED = buildGeometries(buildRig());
  return SHARED;
}

export class RobotHand {
  /**
   * @param {object} opts
   * @param {'p1'|'p2'} opts.team
   * @param {THREE.Color} opts.color   team glow color (linear)
   * @param {boolean} opts.mirror      true builds a left hand (used for the CPU side)
   */
  constructor({ team = 'p1', color, mirror = false }) {
    this.team = team;
    this.dir = mirror ? -1 : 1; // forward direction along world X
    this.color = new THREE.Color(color);

    const style = TEAM_STYLE[team];
    this.armorMat = new THREE.MeshPhysicalMaterial({ ...style.armor, emissive: 0xffffff, emissiveIntensity: 0 });
    this.metalMat = new THREE.MeshStandardMaterial({ ...style.metal });
    this.glowMat = new THREE.MeshBasicMaterial({ color: this.color.clone() });

    this.group = new THREE.Group();
    this.group.name = `hand-${team}`;
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);
    this.rig = new THREE.Group();
    this.pivot.add(this.rig);

    this.bones = buildRig();
    this.rig.add(this.bones[0]);
    const geos = sharedGeometry();
    this.meshes = [];
    for (const [kind, mat] of [
      ['armor', this.armorMat],
      ['metal', this.metalMat],
      ['glow', this.glowMat],
    ]) {
      const mesh = new THREE.SkinnedMesh(geos[kind], mat);
      mesh.frustumCulled = false;
      mesh.castShadow = kind !== 'glow';
      mesh.receiveShadow = kind !== 'glow';
      this.rig.add(mesh);
      this.meshes.push(mesh);
    }
    this.rig.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    for (const mesh of this.meshes) mesh.bind(this.skeleton);

    // Base orientation: fingers toward +X, back of hand tilted toward the camera.
    this.pivot.rotation.set(-0.25, -0.6, -Math.PI / 2);
    if (mirror) this.group.scale.x = -1;

    // Joint springs: per bone x/y/z.
    this.cur = new Float32Array(NUM_BONES * 3);
    this.vel = new Float32Array(NUM_BONES * 3);
    this.tgt = new Float32Array(NUM_BONES * 3);
    this.delay = new Float32Array(NUM_BONES);
    this.pending = new Float32Array(NUM_BONES * 3);
    this.stiffness = 520;
    this.damping = 30;
    this.poseName = 'relaxed';
    this.setPose('relaxed', { instant: true });

    // Root motion layers.
    this.home = new THREE.Vector3();
    this.homeRot = new THREE.Euler();
    this.anim = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1 };
    this.kick = {
      x: new Spring(0, 110, 11),
      y: new Spring(0, 110, 11),
      rz: new Spring(0, 90, 8),
      rx: new Spring(0, 90, 8),
    };
    this.idle = 1;
    this.phase = Math.random() * 100;

    // Visual state.
    this.glow = 1;
    this.glowFlicker = 0;
    this.hitFlash = 0;
    this.power = 1; // 0 = powered down (KO)
  }

  get object() {
    return this.group;
  }

  setPose(name, { instant = false, stagger = 0.016, stiffness = 520, damping = 30 } = {}) {
    const pose = POSES[name];
    if (!pose) return;
    this.poseName = name;
    this.stiffness = stiffness;
    this.damping = damping;
    const t = this.pending;
    const set = (bone, x, y, z) => {
      t[bone * 3] = x;
      t[bone * 3 + 1] = y;
      t[bone * 3 + 2] = z;
    };
    set(BONE_ARM, 0, 0, 0);
    set(BONE_WRIST, pose.wrist[0], 0, pose.wrist[1]);
    pose.fingers.forEach(([spread, c0, c1, c2], fi) => {
      set(fingerBone(fi, 0), -c0, 0, spread);
      set(fingerBone(fi, 1), -c1, 0, 0);
      set(fingerBone(fi, 2), -c2, 0, 0);
    });
    const [tx, ty, tz, c1, c2] = pose.thumb;
    set(thumbBone(0), tx, ty, tz);
    set(thumbBone(1), -c1, 0, 0);
    set(thumbBone(2), -c2, 0, 0);

    for (let b = 0; b < NUM_BONES; b++) {
      let d = 0;
      if (b >= 2 && b < 14) d = Math.floor((b - 2) / 3) * stagger;
      if (b >= 14) d = stagger * 0.5;
      this.delay[b] = instant ? 0 : d;
      if (instant || d <= 0) {
        for (let k = 0; k < 3; k++) this.tgt[b * 3 + k] = t[b * 3 + k];
      }
    }
    if (instant) {
      this.cur.set(this.tgt);
      this.vel.fill(0);
      this._applyBones();
    }
  }

  _applyBones() {
    const c = this.cur;
    for (let b = 0; b < NUM_BONES; b++) {
      this.bones[b].rotation.set(c[b * 3], c[b * 3 + 1], c[b * 3 + 2]);
    }
  }

  // World-space helpers for effects.
  palmCenter(target = new THREE.Vector3()) {
    this.group.updateMatrixWorld(true);
    return this.bones[BONE_WRIST].localToWorld(target.set(0, 0.5, 0.0));
  }

  frontPoint(target = new THREE.Vector3()) {
    this.group.updateMatrixWorld(true);
    if (this.poseName === 'rock') return this.bones[BONE_WRIST].localToWorld(target.set(0, 1.08, -0.05));
    const tip = this.bones[fingerBone(1, 2)];
    return tip.localToWorld(target.set(0, FINGERS[1].len[2], 0));
  }

  fingerTip(fi, target = new THREE.Vector3()) {
    const tip = this.bones[fingerBone(fi, 2)];
    return tip.localToWorld(target.set(0, FINGERS[fi].len[2], 0));
  }

  impulse({ x = 0, y = 0, rz = 0, rx = 0 } = {}) {
    this.kick.x.impulse(x);
    this.kick.y.impulse(y);
    this.kick.rz.impulse(rz);
    this.kick.rx.impulse(rx);
  }

  update(dt, time) {
    // Joint springs.
    if (dt > 0) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      const k = this.stiffness;
      const c = this.damping;
      for (let b = 0; b < NUM_BONES; b++) {
        if (this.delay[b] > 0) {
          this.delay[b] -= dt;
          if (this.delay[b] <= 0) {
            for (let j = 0; j < 3; j++) this.tgt[b * 3 + j] = this.pending[b * 3 + j];
          }
        }
      }
      const cur = this.cur;
      const vel = this.vel;
      const tgt = this.tgt;
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < cur.length; i++) {
          const a = k * (tgt[i] - cur[i]) - c * vel[i];
          vel[i] += a * h;
          cur[i] += vel[i] * h;
        }
      }
      this._applyBones();
      for (const key in this.kick) this.kick[key].update(dt);
    }

    // Root transform = home + animated offsets + impact springs + idle motion.
    const t = time + this.phase;
    const idle = this.idle;
    const dir = this.dir;
    const a = this.anim;
    const bobY = (Math.sin(t * 1.7) * 0.045 + noise1(t * 0.6) * 0.03) * idle;
    const swayZ = (Math.sin(t * 1.25) * 0.035 + noise1(t * 0.45 + 10) * 0.03) * idle;
    const swayX = noise1(t * 0.5 + 30) * 0.035 * idle;
    this.group.position.set(
      this.home.x + dir * (a.x + this.kick.x.value + swayX),
      this.home.y + a.y + this.kick.y.value + bobY,
      this.home.z + a.z
    );
    this.group.rotation.set(
      this.homeRot.x + a.rx + this.kick.rx.value,
      this.homeRot.y + dir * a.ry,
      this.homeRot.z + dir * (a.rz + this.kick.rz.value + swayZ)
    );
    const sc = a.s;
    this.group.scale.set(dir * sc, sc, sc);

    // Materials.
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3.2);
    this.armorMat.emissiveIntensity = this.hitFlash * 1.6;
    let g = this.glow * this.power;
    if (this.glowFlicker > 0) {
      this.glowFlicker = Math.max(0, this.glowFlicker - dt);
      g *= Math.random() < 0.45 ? 0.15 : 1.1;
    }
    // Soft-knee curve: bright at rest, only modestly brighter when charged, so
    // bloom never swamps the screen.
    this.glowMat.color.copy(this.color).multiplyScalar(0.3 + 2.1 * Math.min(g, 1) + 0.7 * Math.max(0, g - 1));
  }
}
