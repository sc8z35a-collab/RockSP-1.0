import * as THREE from 'three';

// Builds a custom HDR "neon studio" environment and prefilters it with PMREM.
// It gives the robot armor colored reflections that match the arena lighting:
// cyan from the player's side, magenta from the CPU's side, white soft boxes.
export function createEnvironmentMap(renderer, colorA, colorB) {
  const scene = new THREE.Scene();
  const disposables = [];

  const roomGeo = new THREE.BoxGeometry(1, 1, 1);
  const roomMat = new THREE.MeshBasicMaterial({ color: 0x06070c, side: THREE.BackSide });
  const room = new THREE.Mesh(roomGeo, roomMat);
  room.scale.set(32, 18, 32);
  room.position.y = 6;
  scene.add(room);
  disposables.push(roomGeo, roomMat);

  const planeGeo = new THREE.PlaneGeometry(1, 1);
  disposables.push(planeGeo);
  const panel = (w, h, color, intensity, pos, look) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(planeGeo, mat);
    m.scale.set(w, h, 1);
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(look[0], look[1], look[2]);
    scene.add(m);
    disposables.push(mat);
  };

  // Overhead soft box and front fill (the camera side) for broad clearcoat highlights.
  panel(12, 7, 0xffffff, 2.4, [0, 14.5, 1], [0, 0, 0]);
  panel(14, 3.5, 0xdbe6ff, 1.35, [0, 4.5, 15.5], [0, 3, 0]);
  // Team colored side walls.
  panel(4, 10, colorA, 2.2, [-15.5, 5, -3], [0, 4, 0]);
  panel(4, 10, colorB, 2.2, [15.5, 5, -3], [0, 4, 0]);
  // Thin back strips give crisp specular streaks.
  for (let i = -3; i <= 3; i++) {
    const c = i < 0 ? colorA : i > 0 ? colorB : 0xffffff;
    panel(0.5, 10, c, i === 0 ? 4 : 2.6, [i * 3.2, 5.5, -15.5], [i * 3.2, 5.5, 0]);
  }
  // Floor bounce.
  panel(20, 20, 0x202640, 0.35, [0, -2.5, 0], [0, 10, 0]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  for (const d of disposables) d.dispose();
  return rt.texture;
}
