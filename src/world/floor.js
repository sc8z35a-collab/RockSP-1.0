import * as THREE from 'three';

export const LAYER_MAIN_ONLY = 1; // objects on this layer are not mirrored by the floor

const MAX_SHOCKS = 4;

const vertexShader = /* glsl */ `
  uniform mat4 uTexMatrix;
  varying vec4 vReflUv;
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vReflUv = uTexMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  #define MAX_SHOCKS ${MAX_SHOCKS}
  uniform sampler2D uRefl;
  uniform vec2 uReflTexel;
  uniform float uReflStrength;
  uniform float uUseRefl;
  uniform float uTime;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform vec3 uHandA;
  uniform vec3 uHandB;
  uniform float uGlowA;
  uniform float uGlowB;
  uniform vec4 uShock[MAX_SHOCKS];
  uniform vec3 uShockCol[MAX_SHOCKS];
  uniform vec3 uFogCol;
  uniform float uFogDensity;
  uniform float uPulse;
  uniform float uStageR;
  uniform float uCenterGlow;
  varying vec4 vReflUv;
  varying vec3 vWorld;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Hexagonal tiling: xy = offset from cell center, zw = cell id.
  vec4 hexGrid(vec2 p) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
    return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
  }

  void main() {
    vec2 p = vWorld.xz;
    float r = length(p);
    vec3 V = normalize(cameraPosition - vWorld);

    float side = smoothstep(-5.5, 5.5, p.x);
    vec3 team = mix(uColA, uColB, side);
    float stage = 1.0 - smoothstep(uStageR - 0.15, uStageR + 0.15, r);

    // Base: very dark lacquer with a faint team tint near the stage.
    vec3 col = vec3(0.0045, 0.0055, 0.011) + team * 0.004 * stage;

    // Hex grid lines (anti-aliased with screen-space derivatives).
    vec4 hx = hexGrid(p * 1.3);
    vec2 ha = abs(hx.xy);
    float hd = 0.5 - max(dot(ha, vec2(0.5, 0.8660254)), ha.x);
    float fw = fwidth(hd);
    float line = 1.0 - smoothstep(fw * 0.5, fw * 1.5 + 0.018, hd);
    float distFade = exp(-r * 0.06);

    // Random cells softly light up.
    float cid = hash21(hx.zw);
    float slot = floor(uTime * 0.7 + cid * 7.0);
    float lit = step(0.9, hash21(hx.zw + slot)) * stage;
    float litFade = sin(fract(uTime * 0.7 + cid * 7.0) * 3.14159);
    float fill = lit * litFade * (0.25 + 0.75 * smoothstep(0.0, 0.45, hd));

    // Light pools under each hand.
    float dA = length(p - uHandA.xz);
    float dB = length(p - uHandB.xz);
    float poolA = exp(-dA * dA * 0.42) * uGlowA;
    float poolB = exp(-dB * dB * 0.42) * uGlowB;

    float gridI = (0.03 + 0.07 * stage + uPulse * 0.22 * stage) * distFade;
    col += team * (line * gridI + fill * 0.05);

    // Soft contact shadows under the hands.
    float shA = exp(-pow(length((p - uHandA.xz) * vec2(0.42, 1.0)), 2.0) * 1.4);
    float shB = exp(-pow(length((p - uHandB.xz) * vec2(0.42, 1.0)), 2.0) * 1.4);
    col *= 1.0 - 0.6 * max(shA, shB);

    col += uColA * poolA * (line * 1.25 + 0.06) + uColB * poolB * (line * 1.25 + 0.06);

    // Stage rim, dashed inner ring and center emblem.
    float rim = exp(-pow((r - uStageR) * 9.0, 2.0));
    col += team * rim * 0.9;
    float ang = atan(p.y, p.x);
    float dash = step(0.55, fract(ang * 9.549 + uTime * 0.08));
    col += team * exp(-pow((r - uStageR + 0.55) * 22.0, 2.0)) * dash * 0.45;
    float centerRing = exp(-pow((r - 1.15) * 16.0, 2.0)) + exp(-pow((r - 0.55) * 26.0, 2.0)) * 0.6;
    col += mix(vec3(0.7, 0.8, 1.0), team, 0.4) * centerRing * (0.12 + uCenterGlow * 1.4);
    col += vec3(0.9, 0.95, 1.0) * exp(-abs(p.x) * 40.0) * stage * 0.08 * (1.0 - smoothstep(1.2, 6.0, abs(p.y)));

    // Shockwaves.
    for (int i = 0; i < MAX_SHOCKS; i++) {
      vec4 s = uShock[i];
      if (s.w > 0.001) {
        float d = length(p - s.xy);
        float ring = exp(-pow((d - s.z) * 4.5, 2.0));
        float inner = smoothstep(s.z, 0.0, d) * step(d, s.z);
        col += uShockCol[i] * s.w * (ring * (0.9 + line * 2.5) + inner * line * 0.6);
      }
    }

    // Glossy reflection (anisotropic blur stretched along screen Y).
    if (uUseRefl > 0.5) {
      vec2 ruv = vReflUv.xy / vReflUv.w;
      vec2 t = uReflTexel;
      vec3 refl = texture2D(uRefl, ruv).rgb * 0.2;
      refl += texture2D(uRefl, ruv + vec2(t.x * 1.5, t.y * 3.0)).rgb * 0.13;
      refl += texture2D(uRefl, ruv + vec2(-t.x * 1.5, -t.y * 3.0)).rgb * 0.13;
      refl += texture2D(uRefl, ruv + vec2(-t.x * 1.5, t.y * 4.0)).rgb * 0.12;
      refl += texture2D(uRefl, ruv + vec2(t.x * 1.5, -t.y * 4.0)).rgb * 0.12;
      refl += texture2D(uRefl, ruv + vec2(0.0, t.y * 8.0)).rgb * 0.1;
      refl += texture2D(uRefl, ruv + vec2(0.0, -t.y * 8.0)).rgb * 0.1;
      refl += texture2D(uRefl, ruv + vec2(t.x * 3.5, 0.0)).rgb * 0.05;
      refl += texture2D(uRefl, ruv + vec2(-t.x * 3.5, 0.0)).rgb * 0.05;
      float fres = 0.4 + 0.6 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
      float reach = 0.35 + 0.65 * exp(-r * r * 0.012);
      col += refl * uReflStrength * fres * reach * (1.0 - line * 0.35);
    }

    float dist = length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogCol, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Glossy hex-grid stage floor with a real-time planar reflection.
export class ReflectiveFloor {
  constructor({ colorA, colorB, fogColor, fogDensity = 0.05, size = 90, stageRadius = 7 }) {
    this.uniforms = {
      uRefl: { value: null },
      uTexMatrix: { value: new THREE.Matrix4() },
      uReflTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      uReflStrength: { value: 0.6 },
      uUseRefl: { value: 1 },
      uTime: { value: 0 },
      uColA: { value: new THREE.Color(colorA) },
      uColB: { value: new THREE.Color(colorB) },
      uHandA: { value: new THREE.Vector3(-3, 0, 0) },
      uHandB: { value: new THREE.Vector3(3, 0, 0) },
      uGlowA: { value: 1 },
      uGlowB: { value: 1 },
      uShock: { value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Vector4()) },
      uShockCol: { value: Array.from({ length: MAX_SHOCKS }, () => new THREE.Color()) },
      uFogCol: { value: new THREE.Color(fogColor) },
      uFogDensity: { value: fogDensity },
      uPulse: { value: 0 },
      uStageR: { value: stageRadius },
      uCenterGlow: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      fog: false,
    });
    const geometry = new THREE.PlaneGeometry(size, size, 1, 1);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.layers.set(LAYER_MAIN_ONLY);
    this.mesh.updateMatrixWorld(true);

    this.shocks = Array.from({ length: MAX_SHOCKS }, () => ({ t: 1, dur: 1, x: 0, z: 0, maxR: 1, power: 0 }));
    this._shockIdx = 0;

    this.renderTarget = null;
    this.scale = 0.5;
    this.enabled = true;
    this.refCam = new THREE.PerspectiveCamera();
    this.refCam.layers.set(0);
    this._tmp = {
      camPos: new THREE.Vector3(),
      look: new THREE.Vector3(),
      target: new THREE.Vector3(),
      rot: new THREE.Matrix4(),
      plane: new THREE.Plane(),
      clip: new THREE.Vector4(),
      q: new THREE.Vector4(),
      normal: new THREE.Vector3(0, 1, 0),
      origin: new THREE.Vector3(0, 0, 0),
    };
  }

  setQuality(width, height, scale) {
    this.scale = scale;
    this.enabled = scale > 0;
    this.uniforms.uUseRefl.value = this.enabled ? 1 : 0;
    if (!this.enabled) {
      if (this.renderTarget) {
        this.renderTarget.dispose();
        this.renderTarget = null;
      }
      return;
    }
    const w = Math.max(64, Math.round(width * scale));
    const h = Math.max(64, Math.round(height * scale));
    if (!this.renderTarget) {
      this.renderTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
      this.renderTarget.texture.generateMipmaps = false;
    } else {
      this.renderTarget.setSize(w, h);
    }
    this.uniforms.uRefl.value = this.renderTarget.texture;
    this.uniforms.uReflTexel.value.set(1 / w, 1 / h);
  }

  shockwave(x, z, { color = 0xffffff, maxR = 6, dur = 0.9, power = 1.5 } = {}) {
    const i = this._shockIdx;
    this._shockIdx = (i + 1) % MAX_SHOCKS;
    Object.assign(this.shocks[i], { t: 0, dur, x, z, maxR, power });
    this.uniforms.uShockCol.value[i].set(color);
  }

  update(dt, elapsed) {
    this.uniforms.uTime.value = elapsed;
    this.shocks.forEach((s, i) => {
      const u = this.uniforms.uShock.value[i];
      if (s.t >= s.dur) {
        u.w = 0;
        return;
      }
      s.t += dt;
      const p = Math.min(1, s.t / s.dur);
      const e = 1 - Math.pow(1 - p, 3);
      u.set(s.x, s.z, e * s.maxR, s.power * (1 - p) * (1 - p));
    });
  }

  renderReflection(renderer, scene, camera) {
    if (!this.enabled || !this.renderTarget) return;
    const T = this._tmp;
    const refCam = this.refCam;
    camera.updateMatrixWorld();
    T.camPos.setFromMatrixPosition(camera.matrixWorld);
    T.rot.extractRotation(camera.matrixWorld);
    T.look.set(0, 0, -1).applyMatrix4(T.rot).add(T.camPos);

    refCam.position.set(T.camPos.x, -T.camPos.y, T.camPos.z);
    T.target.set(T.look.x, -T.look.y, T.look.z);
    refCam.up.set(0, 1, 0).applyMatrix4(T.rot);
    refCam.up.y *= -1;
    refCam.lookAt(T.target);
    refCam.near = camera.near;
    refCam.far = camera.far;
    refCam.updateMatrixWorld();
    refCam.projectionMatrix.copy(camera.projectionMatrix);

    const tm = this.uniforms.uTexMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(refCam.projectionMatrix);
    tm.multiply(refCam.matrixWorldInverse);
    tm.multiply(this.mesh.matrixWorld);

    // Oblique near plane so nothing below the floor leaks into the reflection.
    T.plane.setFromNormalAndCoplanarPoint(T.normal, T.origin);
    T.plane.applyMatrix4(refCam.matrixWorldInverse);
    T.clip.set(T.plane.normal.x, T.plane.normal.y, T.plane.normal.z, T.plane.constant);
    const pm = refCam.projectionMatrix.elements;
    T.q.x = (Math.sign(T.clip.x) + pm[8]) / pm[0];
    T.q.y = (Math.sign(T.clip.y) + pm[9]) / pm[5];
    T.q.z = -1.0;
    T.q.w = (1.0 + pm[10]) / pm[14];
    T.clip.multiplyScalar(2.0 / T.clip.dot(T.q));
    pm[2] = T.clip.x;
    pm[6] = T.clip.y;
    pm[10] = T.clip.z + 1.0;
    pm[14] = T.clip.w;

    const prevTarget = renderer.getRenderTarget();
    const prevAutoUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.renderTarget);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, refCam);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevAutoUpdate;
  }
}
