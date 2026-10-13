import * as THREE from 'three';
import { RobotHand } from '../world/hand.js';

const tonemapFragment = /* glsl */ `
  uniform sampler2D tSrc;
  varying vec2 vUv;
  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 aces(vec3 color) {
    const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    return clamp(O * RRTAndODTFit(I * (color / 0.6)), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
  }
  void main() {
    vec4 c = texture2D(tSrc, vUv);
    float a = clamp(c.a, 0.0, 1.0);
    vec3 col = a > 0.001 ? c.rgb / a : vec3(0.0);
    gl_FragColor = vec4(toSRGB(aces(col * 1.05)), a);
  }
`;

// Renders the robot hand in each pose to small transparent PNGs so the UI
// buttons show the very same 3D hand the player controls.
export function renderHandIcons(renderer, envMap, color, size = 256) {
  const scene = new THREE.Scene();
  scene.environment = envMap;
  scene.environmentIntensity = 1.1;
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-2, 4, 5);
  const rim = new THREE.DirectionalLight(color, 4);
  rim.position.set(3, 2, -4);
  const rim2 = new THREE.DirectionalLight(0xff2e63, 1.6);
  rim2.position.set(-4, 1, -3);
  scene.add(key, rim, rim2, new THREE.HemisphereLight(0x8899cc, 0x111122, 0.7));

  const hand = new RobotHand({ team: 'p1', color });
  hand.idle = 0;
  hand.pivot.rotation.set(0.12, -0.42, 0.06);
  scene.add(hand.group);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, samples: 4 });
  const ldr = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType });
  const quadMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: rt.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: tonemapFragment,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx2d = canvas.getContext('2d');
  const pixels = new Uint8Array(size * size * 4);

  const prevTarget = renderer.getRenderTarget();
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();

  // Frame every pose with a common scale so the icons feel consistent.
  const pts = [];
  const boxes = {};
  let maxDim = 0;
  const poses = ['rock', 'scissors', 'paper'];
  // The fist reads best tilted toward the camera so its knuckles show.
  const tilt = { rock: 0.62, scissors: 0.12, paper: 0.12 };
  for (const pose of poses) {
    hand.pivot.rotation.x = tilt[pose];
    hand.setPose(pose, { instant: true });
    hand.update(0, 0);
    hand.group.updateMatrixWorld(true);
    pts.length = 0;
    for (let f = 0; f < 4; f++) pts.push(hand.fingerTip(f));
    const wrist = hand.bones[1];
    for (const [x, y] of [
      [-0.5, 0.0],
      [0.5, 0.0],
      [-0.5, 0.95],
      [0.5, 0.95],
    ]) {
      pts.push(wrist.localToWorld(new THREE.Vector3(x, y, 0)));
    }
    pts.push(hand.bones[16].localToWorld(new THREE.Vector3(0, 0.25, 0)));
    const box = new THREE.Box3().setFromPoints(pts).expandByScalar(0.16);
    boxes[pose] = box;
    const s = box.getSize(new THREE.Vector3());
    maxDim = Math.max(maxDim, s.x, s.y);
  }

  const out = {};
  try {
    for (const pose of poses) {
      hand.pivot.rotation.x = tilt[pose];
      hand.setPose(pose, { instant: true });
      hand.update(0, 0);
      const c = boxes[pose].getCenter(new THREE.Vector3());
      const dist = (maxDim * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.04;
      camera.position.set(c.x, c.y, c.z + dist);
      camera.lookAt(c);
      camera.updateMatrixWorld();

      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(ldr);
      renderer.clear();
      renderer.render(quadScene, quadCam);
      renderer.readRenderTargetPixels(ldr, 0, 0, size, size, pixels);

      const img = ctx2d.createImageData(size, size);
      const row = size * 4;
      for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * row;
        img.data.set(pixels.subarray(src, src + row), y * row);
      }
      ctx2d.putImageData(img, 0, 0);
      out[pose] = canvas.toDataURL('image/png');
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    rt.dispose();
    ldr.dispose();
    quadMat.dispose();
    quad.geometry.dispose();
    hand.armorMat.dispose();
    hand.metalMat.dispose();
    hand.glowMat.dispose();
  }
  return out;
}
