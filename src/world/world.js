import * as THREE from 'three';
import { createEnvironmentMap } from './environment.js';
import { ReflectiveFloor, LAYER_MAIN_ONLY } from './floor.js';
import { Arena } from './arena.js';
import { RobotHand } from './hand.js';

export const TEAM_COLORS = {
  p1: 0x1fd2ff,
  p2: 0xff2e63,
};
export const FOG_COLOR = 0x05060d;

// Hand rest positions (wrist location) and the clash spot per thrown shape.
export const LAYOUT = {
  homeX: 2.65,
  homeY: 1.32,
  // How far forward (toward the center) the wrist travels when throwing each shape.
  reach: { rock: 1.42, scissors: 0.58, paper: 0.54 },
};

// Scene graph: sky, arena, reflective floor, lights and both robot hands.
export class World {
  constructor(core) {
    this.core = core;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.034);
    this.scene = scene;

    this.colorA = new THREE.Color(TEAM_COLORS.p1);
    this.colorB = new THREE.Color(TEAM_COLORS.p2);

    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 220);
    camera.layers.enable(LAYER_MAIN_ONLY);
    camera.position.set(0, 1.9, 7.4);
    this.camera = camera;

    scene.environment = createEnvironmentMap(core.renderer, TEAM_COLORS.p1, TEAM_COLORS.p2);
    scene.environmentIntensity = 0.8;

    this._lights();

    this.arena = new Arena({ colorA: this.colorA, colorB: this.colorB });
    scene.add(this.arena.group);

    this.floor = new ReflectiveFloor({
      colorA: this.colorA,
      colorB: this.colorB,
      fogColor: FOG_COLOR,
      fogDensity: 0.034,
    });
    scene.add(this.floor.mesh);

    this.p1 = new RobotHand({ team: 'p1', color: this.colorA, mirror: false });
    this.p2 = new RobotHand({ team: 'p2', color: this.colorB, mirror: true });
    this.p1.home.set(-LAYOUT.homeX, LAYOUT.homeY, 0);
    this.p2.home.set(LAYOUT.homeX, LAYOUT.homeY, 0);
    scene.add(this.p1.group, this.p2.group);
    this.hands = [this.p1, this.p2];

    this._handPos = new THREE.Vector3();
  }

  _lights() {
    const scene = this.scene;
    const key = new THREE.DirectionalLight(0xf3f6ff, 2.2);
    key.position.set(-2.2, 9.5, 7.5);
    key.target.position.set(0, 1.0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -5.5;
    sc.right = 5.5;
    sc.top = 4;
    sc.bottom = -3;
    sc.near = 2;
    sc.far = 24;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 3;
    scene.add(key, key.target);
    this.keyLight = key;

    const rimA = new THREE.DirectionalLight(this.colorA, 1.6);
    rimA.position.set(-8, 3.5, -6);
    const rimB = new THREE.DirectionalLight(this.colorB, 1.6);
    rimB.position.set(8, 3.5, -6);
    scene.add(rimA, rimB);

    const hemi = new THREE.HemisphereLight(0x3b4670, 0x07070b, 0.35);
    scene.add(hemi);

    // Team colored up-lights that mimic the glow pools on the floor.
    this.upA = new THREE.PointLight(this.colorA, 4, 5, 2);
    this.upA.position.set(-2.4, 0.25, 0.8);
    this.upB = new THREE.PointLight(this.colorB, 4, 5, 2);
    this.upB.position.set(2.4, 0.25, 0.8);
    scene.add(this.upA, this.upB);

    // Impact flash light at the clash point.
    this.flashLight = new THREE.PointLight(0xffffff, 0, 9, 2);
    this.flashLight.position.set(0, 1.4, 0.8);
    scene.add(this.flashLight);
  }

  // Called by RenderCore on resize/quality change.
  applyQuality(width, height, preset) {
    this.keyLight.castShadow = preset.shadows;
    if (this.keyLight.shadow.mapSize.x !== preset.shadowSize) {
      this.keyLight.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
      if (this.keyLight.shadow.map) {
        this.keyLight.shadow.map.dispose();
        this.keyLight.shadow.map = null;
      }
    }
    this.upA.visible = this.upB.visible = preset.lights;
    this.floor.setQuality(width, height, preset.reflection);
    this.arena.setPixelRatio(height / Math.max(1, window.innerHeight));
  }

  update(dt, t) {
    for (const h of this.hands) h.update(dt, t);
    this.arena.update(dt, t);
    this.floor.update(dt, t);

    const u = this.floor.uniforms;
    this.p1.palmCenter(this._handPos);
    u.uHandA.value.copy(this._handPos);
    this.p2.palmCenter(this._handPos);
    u.uHandB.value.copy(this._handPos);
    u.uGlowA.value = 0.55 + this.p1.glow * this.p1.power * 0.65;
    u.uGlowB.value = 0.55 + this.p2.glow * this.p2.power * 0.65;
    u.uPulse.value = this.arena.pulse;
    this.upA.position.x = u.uHandA.value.x + 0.4;
    this.upB.position.x = u.uHandB.value.x - 0.4;
    this.upA.intensity = 1.2 + this.p1.glow * this.p1.power * 1.8;
    this.upB.intensity = 1.2 + this.p2.glow * this.p2.power * 1.8;
  }

  render(dt) {
    this.floor.renderReflection(this.core.renderer, this.scene, this.camera);
    this.core.render(dt);
  }
}
