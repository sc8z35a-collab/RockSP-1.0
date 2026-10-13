import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute float aAlong;
  attribute float aSide;
  varying float vAlong;
  varying float vSide;
  void main() {
    vAlong = aAlong;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vAlong;
  varying float vSide;
  void main() {
    float edge = exp(-vSide * vSide * 3.5);
    float head = pow(1.0 - vAlong, 1.6);
    vec3 col = mix(uColor, vec3(1.0), edge * head * 0.5) * edge * head * uIntensity;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const _side = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _view = new THREE.Vector3();

// Camera-facing ribbon that follows a moving point (e.g. a fist during a thrust).
export class Trail {
  constructor({ color = 0xffffff, length = 18, width = 0.35 } = {}) {
    this.n = length;
    this.width = width;
    this.points = Array.from({ length }, () => new THREE.Vector3());
    this.active = false;
    this.intensity = 0;
    this.source = null;

    const verts = new Float32Array(length * 2 * 3);
    const along = new Float32Array(length * 2);
    const side = new Float32Array(length * 2);
    const index = [];
    for (let i = 0; i < length; i++) {
      along[i * 2] = along[i * 2 + 1] = i / (length - 1);
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      if (i < length - 1) {
        const a = i * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(verts, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setIndex(index);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 11;
  }

  // `source(target)` writes the current head position into target.
  start(source) {
    this.source = source;
    const p = source(new THREE.Vector3());
    for (const pt of this.points) pt.copy(p);
    this.active = true;
    this.intensity = 1.3;
    this.mesh.visible = true;
  }

  stop() {
    this.active = false;
  }

  update(dt, camera) {
    if (!this.mesh.visible) return;
    if (this.active && this.source) {
      for (let i = this.n - 1; i > 0; i--) this.points[i].lerp(this.points[i - 1], Math.min(1, dt * 38));
      this.source(this.points[0]);
    } else {
      for (let i = this.n - 1; i > 0; i--) this.points[i].lerp(this.points[i - 1], Math.min(1, dt * 22));
      this.intensity = Math.max(0, this.intensity - dt * 5);
      if (this.intensity <= 0) {
        this.mesh.visible = false;
        return;
      }
    }
    this.material.uniforms.uIntensity.value = this.intensity;
    const arr = this.posAttr.array;
    camera.getWorldPosition(_view);
    for (let i = 0; i < this.n; i++) {
      const p = this.points[i];
      const q = this.points[Math.min(this.n - 1, i + 1)];
      const r = this.points[Math.max(0, i - 1)];
      _tan.subVectors(r, q);
      if (_tan.lengthSq() < 1e-8) _tan.set(1, 0, 0);
      _side.subVectors(_view, p).cross(_tan).normalize();
      const w = this.width * (1 - i / this.n);
      arr[i * 6] = p.x - _side.x * w;
      arr[i * 6 + 1] = p.y - _side.y * w;
      arr[i * 6 + 2] = p.z - _side.z * w;
      arr[i * 6 + 3] = p.x + _side.x * w;
      arr[i * 6 + 4] = p.y + _side.y * w;
      arr[i * 6 + 5] = p.z + _side.z * w;
    }
    this.posAttr.needsUpdate = true;
  }
}
