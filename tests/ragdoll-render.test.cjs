'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');
const { RagdollWorld } = require('../physics.js');

const context = vm.createContext({ MayhemCore: core, console, AbortController });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scene3d.js'), 'utf8'), context);
const { THREE: T, MayhemScene: Scene3D } = context;

function makeScene() {
  const game = new core.Game({ seed: 42 });
  game.ragdolls = new RagdollWorld();
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, {
    T, game, scene: new T.Scene(), _geometries: [], _materials: new Map(),
    _color: new T.Color(), _residents: new Map(), _ragdollRenderedCount: 0,
    _lastPlayerX: game.player.x, _lastPlayerY: game.player.y, _walkPhase: 0,
    reducedMotion: false
  });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  scene._sphere = scene._geometry(new T.IcosahedronGeometry(1, 1));
  scene._cylinder = scene._geometry(new T.CylinderGeometry(1, 1, 1, 10));
  scene._player = scene._person('#7b64df', true);
  scene.scene.add(scene._player.group);
  const resident = scene._person(game.peds[0].color, false);
  resident.bubble = { sprite: new T.Sprite(), text: '', canvas: null, texture: null };
  resident.group.add(resident.bubble.sprite);
  scene._residents.set(game.peds[0].id, resident);
  scene.scene.add(resident.group);
  return scene;
}

function transformedPoint(scene, mesh, index, x, y, z) {
  const matrix = new T.Matrix4(); mesh.getMatrixAt(index, matrix);
  return new T.Vector3(x, y, z).applyMatrix4(matrix);
}

function matchesPoint(actual, joint, label) {
  assert.ok(Math.hypot(actual.x - joint.x, actual.y - joint.y, actual.z - joint.z) < 0.00002, label);
}

function addCamera(scene) {
  const cameraTown = Object.create(Scene3D.prototype);
  Object.assign(cameraTown, { T, game: scene.game, _buildingVolumes: [] });
  for (const name of ['_staticBox', '_static', '_material', '_sign', '_park', '_services', '_lamp', '_tree']) cameraTown[name] = () => {};
  cameraTown._town();
  Object.assign(scene, {
    camera: new T.PerspectiveCamera(57, 1280 / 720, 0.06, 175),
    _yaw: -Math.PI / 2, _requestedYaw: -Math.PI / 2, _driveOffset: 0,
    _pitch: 0, _orbitTimer: 0, _cameraMode: 'foot', _lastVehicleId: null, _hasCamera: false,
    _cameraTarget: new T.Vector3(), _desiredCamera: new T.Vector3(),
    _sun: new T.DirectionalLight(), _buildingVolumes: cameraTown._buildingVolumes, _cameraInfo: {}
  });
}

test('fallen rendering follows physical bone endpoints and head instead of a canned pose', () => {
  const scene = makeScene(), game = scene.game;
  assert.equal(game.ragdolls.trigger(game.player, { x: 5, y: 3, z: -2 }), true);
  for (let i = 0; i < 36; i++) game.ragdolls.step(1 / 60, { size: core.SIZE });
  const body = game.ragdolls.get('player');
  scene._people(1 / 60);
  assert.equal(scene.ragdollCount, 1);
  assert.equal(scene._player.group.visible, false);
  assert.equal(scene._ragdollHeads.count, 1);
  assert.equal(scene._ragdollCubes.count, 22);
  matchesPoint(transformedPoint(scene, scene._ragdollCubes, 6, 0, -0.5, 0), body.joints.leftShoulder, 'upper arm starts at the physical shoulder');
  matchesPoint(transformedPoint(scene, scene._ragdollCubes, 6, 0, 0.5, 0), body.joints.leftElbow, 'upper arm ends at the physical elbow');
  matchesPoint(transformedPoint(scene, scene._ragdollCubes, 10, 0, -0.5, 0), body.joints.leftKnee, 'shin starts at the physical knee');
  matchesPoint(transformedPoint(scene, scene._ragdollCubes, 10, 0, 0.5, 0), body.joints.leftFoot, 'shin ends at the physical foot');
  matchesPoint(transformedPoint(scene, scene._ragdollHeads, 0, 0, 0, 0), body.joints.head, 'head follows the physical head joint');
});

test('instance buffers are reused through recovery, repeated flops, and reduced motion', () => {
  const scene = makeScene(), game = scene.game;
  game.ragdolls.trigger(game.player, { x: 3, y: 2 });
  scene._people(0);
  const cubes = scene._ragdollCubes, heads = scene._ragdollHeads;
  const geometries = scene._geometries.length, materials = scene._materials.size;
  const before = Float32Array.from(cubes.instanceMatrix.array);
  scene.reducedMotion = true; scene._people(0);
  assert.deepEqual(Array.from(cubes.instanceMatrix.array), Array.from(before), 'reduced motion keeps exact physical body positions');
  game.ragdolls.get('player').phase = 'recover'; scene._people(0);
  assert.equal(scene._player.group.visible, false, 'recovery joints still render until the solver completes');
  game.ragdolls.clear('player'); scene._people(0);
  assert.equal(scene.ragdollCount, 0); assert.equal(scene._player.group.visible, true);
  assert.equal(cubes.count, 0); assert.equal(cubes.visible, false); assert.equal(heads.count, 0);
  for (let i = 0; i < 50; i++) {
    game.ragdolls.trigger(game.player, { x: 1 }); scene._people(0);
    game.ragdolls.clear('player'); scene._people(0);
  }
  assert.equal(scene._ragdollCubes, cubes); assert.equal(scene._ragdollHeads, heads);
  assert.equal(scene._geometries.length, geometries, 'flops never allocate geometry');
  assert.equal(scene._materials.size, materials, 'flops never allocate materials');
});

test('resident bubbles remain upright above fallen people and return to their standing models', () => {
  const scene = makeScene(), game = scene.game, ped = game.peds[0];
  const resident = scene._residents.get(ped.id), bubble = resident.bubble.sprite;
  game.ragdolls.trigger(ped, { x: 5, y: 2 });
  for (let i = 0; i < 20; i++) game.ragdolls.step(1 / 60, { size: core.SIZE });
  scene._people(0);
  const body = game.ragdolls.get(ped.id);
  assert.equal(resident.group.visible, false); assert.equal(bubble.parent, scene.scene);
  assert.ok(bubble.position.y > Math.max(body.joints.head.y, body.joints.pelvis.y) + 0.5);
  assert.equal(bubble.position.x, body.joints.pelvis.x);
  assert.equal(scene._ragdollCubes.count, 18);
  game.ragdolls.clear(ped.id); scene._people(0);
  assert.equal(resident.group.visible, true); assert.equal(bubble.parent, resident.group);
  assert.equal(bubble.position.y, 2.27);
});

test('the camera follows physical fallen height and keeps a safe boom at walls, corners, and rooftops', () => {
  const scene = makeScene(); addCamera(scene);
  const game = scene.game, player = game.player;
  let checked = 0;
  for (const building of game.buildings) {
    const x = building.x / 20, z = building.y / 20, w = building.w / 20, d = building.h / 20;
    for (const point of [
      { x: x - 0.19, z: z + d / 2, height: 0 },
      { x: x + w + 0.19, z: z + d / 2, height: 0 },
      { x: x - 0.19, z: z - 0.19, height: 0 },
      { x: x + w + 0.19, z: z + d + 0.19, height: 0 },
      { x: x + w / 2, z: z + d / 2, height: building.height + 0.5 }
    ]) {
      game.ragdolls.clearAll();
      Object.assign(player, { x: point.x * 20, y: point.z * 20, angle: -Math.PI / 2 });
      game.ragdolls.trigger(player, { x: 2, y: 3, z: -1 }, { height: point.height });
      scene.recenter();
      for (let i = 0; i < 30; i++) {
        game.ragdolls.step(1 / 60, { buildings: game.buildings, size: core.SIZE });
        scene.orbit(i % 2 ? -4 : 6, 0); scene._cameraStep(1 / 60);
        const info = scene.cameraInfo;
        for (const value of Object.values(info).filter(value => typeof value === 'number')) assert.ok(Number.isFinite(value));
        assert.ok(info.distance > 0.05, 'fallen pivot never collapses the camera boom: ' + JSON.stringify({ point, i, info }));
        assert.equal(scene._insideBuilding(info.x, info.y, info.z), false, 'fallen camera stays outside geometry');
        scene.camera.updateMatrixWorld();
        const direction = scene.camera.getWorldDirection(new T.Vector3());
        assert.ok(Math.abs(Math.atan2(Math.sin(info.viewYaw - Math.atan2(direction.z, direction.x)), Math.cos(info.viewYaw - Math.atan2(direction.z, direction.x)))) < 0.000001);
        if (point.height > 0 && i < 2) assert.ok(info.targetY > 3, 'a launched or rooftop body raises the camera pivot');
        checked++;
      }
    }
  }
  assert.ok(checked > 1000);
});
