'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');

const context = vm.createContext({ MayhemCore: core, console, AbortController });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scene3d.js'), 'utf8'), context);
const { THREE: T, MayhemScene: Scene3D } = context;
const wrapped = value => Math.atan2(Math.sin(value), Math.cos(value));

function makeScene() {
  const game = new core.Game({ seed: 42 });
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, {
    T, game, width: 1280, height: 720,
    camera: new T.PerspectiveCamera(57, 1280 / 720, 0.06, 175),
    _yaw: -Math.PI / 2, _requestedYaw: -Math.PI / 2, _driveOffset: 0,
    _pitch: 0, _orbitTimer: 0, _cameraMode: 'foot', _lastVehicleId: null, _hasCamera: false,
    _cameraTarget: new T.Vector3(), _desiredCamera: new T.Vector3(),
    _ray: new T.Raycaster(), _pointer: new T.Vector2(),
    _ground: new T.Plane(new T.Vector3(0, 1, 0), 0), _aimPoint: new T.Vector3(),
    _sun: new T.DirectionalLight(), _buildingVolumes: [], _cameraInfo: {}
  });
  scene.camera.position.set(game.current.x / 20, 3.4, game.current.y / 20 + 5.7);
  // Use the real town geometry to obtain collision envelopes. Only decoration
  // drawing is suppressed; vectors, camera transforms, and camera methods run.
  for (const name of ['_staticBox', '_static', '_material', '_sign', '_park', '_services', '_lamp', '_tree']) scene[name] = () => {};
  scene._town();
  return scene;
}

function assertSafeCamera(scene) {
  const info = scene.cameraInfo;
  for (const key of ['x', 'y', 'z', 'targetX', 'targetY', 'targetZ', 'distance', 'viewYaw']) assert.ok(Number.isFinite(info[key]), key + ' must be finite');
  assert.ok(info.distance > 0.01, 'the camera must never collapse onto its target');
  assert.equal(info.mode, scene.game.player.vehicleId ? 'drive' : 'foot');
  assert.ok(Math.abs(info.targetX - scene.game.current.x / 20) < 1e-9);
  assert.ok(Math.abs(info.targetZ - scene.game.current.y / 20) < 1e-9);
  for (const box of scene._buildingVolumes) {
    const inside = info.x > box.minX - 0.17 && info.x < box.maxX + 0.17
      && info.z > box.minZ - 0.17 && info.z < box.maxZ + 0.17
      && info.y > box.minY && info.y < box.maxY + 0.17;
    assert.equal(inside, false, 'camera must stay outside buildings and their near-plane clearance');
  }
  scene.camera.updateMatrixWorld();
  const direction = scene.camera.getWorldDirection(new T.Vector3());
  assert.ok(Math.abs(wrapped(info.viewYaw - Math.atan2(direction.z, direction.x))) < 1e-9,
    'movement heading must follow the actual rendered camera, including shoulder avoidance');
}

function frames(scene, count, dt = 1 / 60) {
  for (let i = 0; i < count; i++) { scene._cameraStep(dt); assertSafeCamera(scene); }
}

function place(scene, point, heading) {
  Object.assign(scene.game.current, { x: point.x, y: point.y, angle: heading });
  if (scene.game.player.vehicleId) Object.assign(scene.game.player, { x: point.x, y: point.y, angle: heading });
}

test('initial on-foot and driving cameras have comfortable viewing distance through entry and exit', () => {
  const scene = makeScene();
  frames(scene, 1);
  assert.ok(scene.cameraInfo.distance > 2);
  assert.equal(scene.game.interact(), true);
  frames(scene, 120);
  assert.equal(scene.cameraInfo.mode, 'drive');
  assert.ok(scene.cameraInfo.distance > 3);
  assert.equal(scene.game.interact(), true);
  frames(scene, 120);
  assert.equal(scene.cameraInfo.mode, 'foot');
  assert.ok(scene.cameraInfo.distance > 2);
});

test('camera stays finite and outside buildings across sampled streets, corners, headings, and modes', () => {
  const foot = makeScene();
  const points = [];
  for (const building of foot.game.buildings) {
    for (const x of [building.x - 20, building.x + building.w + 20]) {
      for (const y of [building.y - 20, building.y + building.h + 20]) points.push({ x, y });
    }
  }
  let seed = 719;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  while (points.length < 150) {
    const point = { x: 20 + random() * (core.SIZE - 40), y: 20 + random() * (core.SIZE - 40) };
    if (foot.game._isFree(point.x, point.y, 18)) points.push(point);
  }
  let checked = 0;
  for (const driving of [false, true]) {
    const scene = driving ? makeScene() : foot;
    if (driving) assert.equal(scene.game.interact(), true);
    for (const point of points) {
      assert.ok(scene.game._isFree(point.x, point.y, driving ? 18 : 10));
      for (let heading = -Math.PI; heading < Math.PI - 0.0001; heading += Math.PI / 4) {
        place(scene, point, heading);
        if (driving) scene.game.current.speed = Math.cos(heading) > 0 ? 0 : 300;
        scene.recenter();
        for (let i = 0; i < 6; i++) {
          scene._cameraStep(i % 2 ? 1 / 30 : 1 / 120);
          assertSafeCamera(scene); checked++;
        }
      }
    }
  }
  assert.ok(checked > 10000);
});

test('large teleports, tight corner transitions, and actual recovery never collapse the camera', () => {
  const scene = makeScene();
  frames(scene, 1);
  for (const point of [{ x: 2150, y: 10 }, { x: 230, y: 230 }, { x: 2150, y: 2150 }, { x: 850, y: 1210 }, { x: 950, y: 1210 }]) {
    assert.ok(scene.game._isFree(point.x, point.y, 10));
    place(scene, point, Math.PI);
    scene.recenter();
    frames(scene, 30);
  }
  place(scene, { x: 350, y: 350 }, 0);
  assert.equal(scene.game.recover(), true);
  frames(scene, 30);
  scene.game.player.x = 884; scene.game.player.y = 1080;
  assert.equal(scene.game.interact(), true);
  frames(scene, 30);
  place(scene, { x: 350, y: 350 }, 0);
  assert.equal(scene.game.recover(), true);
  frames(scene, 30);
  assert.equal(scene.game.interact(), true);
  frames(scene, 30);
});

test('orbit and recenter use smooth third-person headings and the driving camera settles behind the car', () => {
  const scene = makeScene();
  place(scene, { x: 1080, y: 1080 }, -Math.PI / 2);
  frames(scene, 1);
  const originalYaw = scene.viewYaw, originalHeight = scene.cameraInfo.y;
  scene.orbit(-100, 50);
  frames(scene, 120);
  assert.ok(wrapped(scene.viewYaw - originalYaw) > 0.3);
  assert.ok(scene.cameraInfo.y > originalHeight + 0.2);
  scene.game.player.angle = Math.PI / 2;
  scene.recenter(); frames(scene, 120);
  assert.ok(Math.abs(wrapped(scene.viewYaw - scene.game.player.angle)) < 0.0001);

  scene.game.cars[0].x = 1080; scene.game.cars[0].y = 1080;
  assert.equal(scene.game.interact(), true);
  frames(scene, 1);
  scene.game.current.angle = 0;
  scene.recenter(); frames(scene, 120);
  assert.ok(Math.abs(wrapped(scene.viewYaw)) < 0.0001);
  scene.orbit(-150, 30); frames(scene, 60);
  assert.ok(Math.abs(wrapped(scene.viewYaw)) > 0.3);
  frames(scene, 840);
  assert.ok(Math.abs(wrapped(scene.viewYaw - scene.game.current.angle)) < 0.0001);
  const stoppedDistance = scene.cameraInfo.distance;
  scene.game.current.speed = 370;
  frames(scene, 180);
  assert.ok(scene.cameraInfo.distance > stoppedDistance + 0.5, 'fast driving should widen the view');
});

test('ground aiming uses real camera projection and near-feet or sky clicks keep the view heading', () => {
  const scene = makeScene();
  place(scene, { x: 1080, y: 1080 }, -Math.PI / 2);
  frames(scene, 1);
  const feet = new T.Vector3(54, 0, 54);
  const aimAt = point => {
    const projected = point.clone().project(scene.camera);
    return scene.aimAngle((projected.x + 1) * scene.width / 2, (1 - projected.y) * scene.height / 2);
  };
  assert.ok(Math.abs(wrapped(aimAt(feet) - scene.viewYaw)) < 1e-9);
  assert.ok(Math.abs(wrapped(aimAt(feet.clone().add(new T.Vector3(0.4, 0, 0.4))) - scene.viewYaw)) < 1e-9);
  const distant = feet.clone().add(new T.Vector3(2, 0, -5));
  assert.ok(Math.abs(wrapped(aimAt(distant) - Math.atan2(-5, 2))) < 1e-9);
  assert.ok(Math.abs(wrapped(scene.aimAngle(scene.width / 2, 0) - scene.viewYaw)) < 1e-9);
});
