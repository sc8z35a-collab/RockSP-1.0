import * as THREE from 'three';

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uIntensity;
  uniform float uThickness;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float rad = uProgress;
    float w = uThickness * (1.0 - uProgress * 0.6);
    float ring = exp(-pow((r - rad) / w, 2.0));
    float inner = smoothstep(rad, 0.0, r) * 0.12;
    float fade = (1.0 - uProgress);
    vec3 col = mix(uColor, vec3(1.0), ring * 0.45) * (ring + inner) * fade * fade * uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const flareFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float core = exp(-dot(p, p) * 26.0);
    float halo = exp(-dot(p, p) * 5.0) * 0.12;
    float streak = exp(-abs(p.y) * 70.0) * exp(-abs(p.x) * 2.6);
    float star = exp(-abs(p.x) * 45.0) * exp(-abs(p.y) * 6.0) * 0.45;
    vec3 col = vec3(1.0) * core * 1.6 + uColor * (halo + streak * 1.5 + star);
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

// Crescent slash: a bright arc whose head sweeps across, leaving a fading trail.
const slashFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uFade;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    vec2 c = vec2(0.0, -1.35);
    float R = 1.65;
    float d = length(p - c) - R;
    float ang = atan(p.x - c.x, p.y - c.y);
    float head = mix(-0.95, 0.95, uProgress);
    float behind = head - ang;
    float trail = smoothstep(-0.02, 0.06, behind) * exp(-max(behind, 0.0) * 2.2);
    float taper = smoothstep(0.98, 0.6, abs(ang));
    float thick = 0.055 * (0.35 + 0.65 * exp(-max(behind, 0.0) * 1.5));
    float core = exp(-pow(d / (thick * 0.28), 2.0));
    float glow = exp(-pow(d / thick, 2.0));
    vec3 col = (vec3(1.0) * core * 2.8 + uColor * glow * 2.6) * trail * taper * uFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const wrapVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const wrapFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uIntensity;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying vec3 vLocal;
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float f = 1.0 - abs(dot(normalize(vNormalW), V));
    float rim = pow(f, 2.2);
    vec3 n = normalize(vLocal);
    float lat = asin(clamp(n.y, -1.0, 1.0));
    float lon = atan(n.z, n.x);
    float bands = 0.5 + 0.5 * sin(lat * 14.0 - uTime * 9.0);
    float swirl = 0.5 + 0.5 * sin(lon * 6.0 + lat * 5.0 + uTime * 7.0);
    float pattern = pow(bands * swirl, 3.0);
    vec3 col = uColor * (rim * 1.4 + pattern * 0.55 + 0.05) + vec3(1.0) * pow(rim, 5.0) * 0.8;
    gl_FragColor = vec4(col * uIntensity, 1.0);
  }
`;

function additiveMaterial(uniforms, vertexShader, fragmentShader, side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side,
    fog: false,
  });
}

const planeGeo = new THREE.PlaneGeometry(1, 1);

// A pool of short-lived, shader-driven sprites. Each kind owns a few meshes that
// are re-used; `update` advances them and hides finished ones.
export class Sprites {
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.active = [];
    this.pools = {
      ring: this._pool(6, () =>
        additiveMaterial(
          {
            uColor: { value: new THREE.Color() },
            uProgress: { value: 0 },
            uIntensity: { value: 1 },
            uThickness: { value: 0.08 },
          },
          quadVertex,
          ringFragment,
          THREE.DoubleSide
        )
      ),
      flare: this._pool(4, () =>
        additiveMaterial(
          { uColor: { value: new THREE.Color() }, uIntensity: { value: 1 }, uAspect: { value: 1 } },
          quadVertex,
          flareFragment
        )
      ),
      slash: this._pool(4, () =>
        additiveMaterial(
          { uColor: { value: new THREE.Color() }, uProgress: { value: 0 }, uFade: { value: 1 } },
          quadVertex,
          slashFragment,
          THREE.DoubleSide
        )
      ),
    };
    const sphere = new THREE.SphereGeometry(1, 40, 28);
    this.wrap = new THREE.Mesh(
      sphere,
      additiveMaterial(
        { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uIntensity: { value: 0 } },
        wrapVertex,
        wrapFragment
      )
    );
    this.wrap.visible = false;
    this.group.add(this.wrap);
    this._wrapState = null;
  }

  _pool(n, makeMat) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(planeGeo, makeMat());
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 12;
      this.group.add(m);
      list.push(m);
    }
    return { list, i: 0 };
  }

  _take(kind) {
    const pool = this.pools[kind];
    const m = pool.list[pool.i];
    pool.i = (pool.i + 1) % pool.list.length;
    this.active = this.active.filter((a) => a.mesh !== m);
    m.visible = true;
    return m;
  }

  /** Expanding ring. facing: 'camera' | 'x' (plane perpendicular to the X axis) | 'floor'. */
  ring(pos, { color = 0xffffff, size = 3, dur = 0.5, intensity = 2.5, thickness = 0.08, facing = 'camera', delay = 0 } = {}) {
    const m = this._take('ring');
    m.position.copy(pos);
    m.scale.setScalar(size);
    m.material.uniforms.uColor.value.set(color);
    m.material.uniforms.uThickness.value = thickness;
    m.material.uniforms.uProgress.value = 0;
    m.material.uniforms.uIntensity.value = delay > 0 ? 0 : intensity;
    m.rotation.set(0, 0, 0);
    if (facing === 'x') m.rotation.y = Math.PI / 2;
    if (facing === 'floor') m.rotation.x = -Math.PI / 2;
    this.active.push({ mesh: m, kind: 'ring', t: -delay, dur, intensity, billboard: facing === 'camera' });
  }

  flare(pos, { color = 0xffffff, size = 2.4, dur = 0.35, intensity = 2 } = {}) {
    const m = this._take('flare');
    m.position.copy(pos);
    m.scale.set(size * 2.2, size, 1);
    m.material.uniforms.uColor.value.set(color);
    m.material.uniforms.uIntensity.value = intensity;
    this.active.push({ mesh: m, kind: 'flare', t: 0, dur, intensity, size, billboard: true });
  }

  slash(pos, { color = 0xffffff, size = 2.6, angle = 0, dur = 0.42, delay = 0 } = {}) {
    const m = this._take('slash');
    m.position.copy(pos);
    m.scale.setScalar(size);
    m.material.uniforms.uColor.value.set(color);
    m.material.uniforms.uProgress.value = 0;
    m.material.uniforms.uFade.value = 0;
    this.active.push({ mesh: m, kind: 'slash', t: -delay, dur, angle, billboard: true });
  }

  /** Energy sphere that engulfs a target (paper beats rock). */
  wrapAround(target, { color = 0xffffff, radius = 1, dur = 0.9 } = {}) {
    this.wrap.visible = true;
    this.wrap.material.uniforms.uColor.value.set(color);
    this._wrapState = { target, radius, dur, t: 0 };
  }

  clear() {
    for (const a of this.active) a.mesh.visible = false;
    this.active.length = 0;
    this.wrap.visible = false;
    this._wrapState = null;
  }

  update(dt, time) {
    const cam = this.camera;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t += dt;
      const m = a.mesh;
      if (a.t < 0) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      const p = Math.min(1, a.t / a.dur);
      if (a.billboard) {
        m.quaternion.copy(cam.quaternion);
        if (a.kind === 'slash') m.rotateZ(a.angle);
      }
      const u = m.material.uniforms;
      if (a.kind === 'ring') {
        u.uProgress.value = 1 - Math.pow(1 - p, 2.4);
        u.uIntensity.value = a.intensity;
      } else if (a.kind === 'flare') {
        const e = 1 - p;
        u.uIntensity.value = a.intensity * e * e;
        m.scale.set(a.size * 2.2 * (1 + p * 0.6), a.size * (1 - p * 0.5), 1);
      } else if (a.kind === 'slash') {
        u.uProgress.value = Math.min(1, p / 0.45);
        u.uFade.value = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
      }
      if (p >= 1) {
        m.visible = false;
        this.active.splice(i, 1);
      }
    }

    const w = this._wrapState;
    if (w) {
      w.t += dt;
      const p = Math.min(1, w.t / w.dur);
      const target = w.target();
      this.wrap.position.copy(target);
      // Grow, hold, then collapse inward.
      let s;
      let inten;
      if (p < 0.3) {
        const k = p / 0.3;
        s = w.radius * (1.6 - 0.6 * (1 - Math.pow(1 - k, 3)));
        inten = k;
      } else if (p < 0.75) {
        s = w.radius * (1 + Math.sin((p - 0.3) * 40) * 0.03);
        inten = 1;
      } else {
        const k = (p - 0.75) / 0.25;
        s = w.radius * (1 - 0.7 * k * k);
        inten = 1 + k * 0.5;
      }
      this.wrap.scale.setScalar(s);
      const u = this.wrap.material.uniforms;
      u.uTime.value = time;
      u.uIntensity.value = inten * 1.25;
      if (p >= 1) {
        this.wrap.visible = false;
        this._wrapState = null;
      }
    }
  }
}
