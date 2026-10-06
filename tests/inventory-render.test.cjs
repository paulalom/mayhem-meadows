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

function makeScene() {
  const game = new core.Game({ seed: 42 });
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, {
    T, game, scene: new T.Scene(), _geometries: [], _materials: new Map(),
    _color: new T.Color(), _dummy: new T.Object3D(), _residents: new Map(), _vehicles: new Map(),
    _lastPlayerX: game.player.x, _lastPlayerY: game.player.y, _walkPhase: 0,
    reducedMotion: false, _cameraInfo: { aiming: false }
  });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  scene._sphere = scene._geometry(new T.IcosahedronGeometry(1, 1));
  scene._cylinder = scene._geometry(new T.CylinderGeometry(1, 1, 1, 12));
  scene._cone = scene._geometry(new T.ConeGeometry(1, 1, 7));
  scene._player = scene._person('#7b64df', true);
  scene.scene.add(scene._player.group);
  return scene;
}

test('equipping each toy changes the held model without allocating geometry or materials', () => {
  const scene = makeScene();
  scene._people(0); // Allocate the reusable ragdoll renderer before counting.
  const geometryCount = scene._geometries.length, materialCount = scene._materials.size;
  for (let cycle = 0; cycle < 20; cycle++) {
    for (const equipped of ['popper', 'hammer', 'cannon']) {
      scene.game.inventory = { equipped };
      scene._people(0);
      assert.equal(scene._player.equipped, equipped);
      for (const [id, toy] of Object.entries(scene._player.toys)) {
        assert.equal(toy.visible, id === equipped);
        assert.equal(toy.parent, scene._player.rightArm);
        assert.ok(toy.children.some(child => child.isMesh), 'each toy has real 3D geometry');
      }
    }
  }
  assert.equal(scene._geometries.length, geometryCount);
  assert.equal(scene._materials.size, materialCount);
  scene.game.inventory = { equipped: 'cannon' }; scene.game._actionCooldown = 1.1;
  scene._people(0);
  assert.equal(scene._player.rightArm.rotation.z, Math.PI / 2, 'a fired barrel points forward');
  scene.game.inventory.equipped = 'hammer'; scene.game._actionCooldown = 0.9;
  scene._people(0);
  assert.ok(scene._player.rightArm.rotation.z > 2, 'hammer starts a raised swing');
  scene.game._actionCooldown = 0.4; scene._people(0);
  assert.ok(scene._player.rightArm.rotation.z < 1.3, 'hammer sweeps forward through the strike');
});

test('held toy visibly follows upward and downward aim and lowers when aiming stops', () => {
  const scene = makeScene();
  scene._cameraInfo.aiming = true;
  const barrel = () => {
    scene._people(0); scene._player.rightArm.updateWorldMatrix(true, false);
    return new T.Vector3(0, -1, 0).transformDirection(scene._player.rightArm.matrixWorld);
  };
  scene.game.player.aimPitch = 0.6;
  assert.ok(barrel().y > 0.5, 'barrel points upward while looking up');
  scene.game.player.aimPitch = -0.6;
  assert.ok(barrel().y < -0.5, 'barrel points downward while looking down');
  scene._cameraInfo.aiming = false;
  assert.ok(barrel().y < -0.95, 'idle character lowers the held toy');
});

test('a real jump lifts the whole character above the street and lands back on its feet', () => {
  const scene = makeScene(), game = scene.game;
  game.player.x = 900; game.player.y = 1080;
  game.peds = [];
  assert.equal(game.jump(), true);
  let apex = 0;
  for (let frame = 0; frame < 90; frame++) {
    game.update(1 / 60, {}); scene._people(1 / 60);
    assert.ok(Math.abs(scene._player.group.position.y - game.player.elevation - 0.03) < 0.000001);
    apex = Math.max(apex, scene._player.group.position.y);
    assert.equal(scene._player.group.visible, true);
  }
  assert.ok(apex > 1.3, 'jump has a clearly visible arc above the street');
  assert.equal(game.player.grounded, true);
  assert.ok(Math.abs(scene._player.group.position.y - 0.03) < 0.00001);
});

test('airborne cars render the full quaternion about the same chassis centre as physics', () => {
  const scene = makeScene(), game = scene.game, car = game.cars[0];
  game.cars = [car]; game.police = [];
  car.elevation = 4.2;
  const orientation = new T.Quaternion().setFromEuler(new T.Euler(0.45, -0.7, 0.8));
  car.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w };
  car.speed = 240; game.vehiclePhysics.sync(); scene._cars(1 / 60);
  const model = scene._vehicles.get(car.id), body = game.vehiclePhysics.bodies.get(car.id).body;
  model.group.updateWorldMatrix(true, true);
  assert.ok(Math.abs(model.group.position.y - body.position.y) < 0.005, 'both systems use the body centre, including spawn clearance');
  assert.ok(1 - Math.abs(model.group.quaternion.dot(orientation)) < 0.000001);
  const roofLocal = new T.Vector3(-0.20, 1.22, 0);
  const actualRoof = model.visual.localToWorld(roofLocal.clone());
  const expectedRoof = roofLocal.clone().add(new T.Vector3(0, 0.04 - model.centerHeight, 0)).applyQuaternion(orientation).add(model.group.position);
  assert.ok(actualRoof.distanceTo(expectedRoof) < 0.00001, 'the roof rotates around the centre rather than the road origin');
  const uprightWheel = model.wheels[0].rotation.z;
  scene._cars(1 / 60);
  assert.notEqual(model.wheels[0].rotation.z, uprightWheel, 'wheel spin stays independent of the chassis rotation');
  assert.ok(1 - Math.abs(model.group.quaternion.dot(orientation)) < 0.000001);
  car.orientation = null; car.angle = 0.3; scene._cars(0);
  assert.ok(Math.abs(model.group.rotation.x) < 0.00001 && Math.abs(model.group.rotation.z) < 0.00001, 'legacy yaw never inherits an old tumble');
});

test('solid street props are rendered once from the shared compound shapes and placements', () => {
  const scene = makeScene();
  scene._staticParts = new Map(); scene._propVolumes = []; scene._propAimMeshes = []; scene._sign = () => {};
  scene._physicalProps();
  const partCount = scene.game.staticObjects.reduce((sum, object) => sum + object.parts.length, 0);
  assert.equal(scene._propAimMeshes.length, partCount, 'each physical part has one matching raycast visual');
  assert.equal(scene._propVolumes.length, partCount);
  let index = 0;
  for (const object of scene.game.staticObjects) for (const part of object.parts) {
    const mesh = scene._propAimMeshes[index++];
    assert.ok(Math.abs(mesh.position.x - object.x / 20 - part.offset[0]) < 0.000001);
    assert.ok(Math.abs(mesh.position.y - object.elevation - part.offset[1]) < 0.000001);
    assert.ok(Math.abs(mesh.position.z - object.y / 20 - part.offset[2]) < 0.000001);
    const bounds = new T.Box3().setFromObject(mesh), size = bounds.getSize(new T.Vector3());
    assert.ok(Math.abs(size.y - part.half[1] * 2) < 0.00001, 'visual collider height uses the map shape');
    assert.ok(Math.abs(size.x - part.half[0] * 2) < 0.025, 'visible cylinder/box uses the physical footprint');
  }
});

test('confetti renders at the vertical shot impact while ordinary confetti keeps its ground lift', () => {
  const scene = makeScene(), material = new T.MeshBasicMaterial();
  scene._confetti = new T.InstancedMesh(scene._cube, material, 360);
  scene._skids = new T.InstancedMesh(scene._cube, material, 250);
  scene._target = new T.Group();
  scene.game.mission = null;
  scene.game.particles = [
    { x: 1080, y: 1080, size: 4, color: '#ffd15b', life: 1, maxLife: 1, height: 5.6 },
    { x: 1080, y: 1080, size: 4, color: '#ffd15b', life: 1, maxLife: 1 }
  ];
  scene._effects();
  const matrix = new T.Matrix4(), position = new T.Vector3();
  scene._confetti.getMatrixAt(0, matrix); position.setFromMatrixPosition(matrix);
  assert.ok(Math.abs(position.y - 5.6) < 0.00001);
  scene._confetti.getMatrixAt(1, matrix); position.setFromMatrixPosition(matrix);
  assert.ok(Math.abs(position.y - 0.2) < 0.00001);
});

test('cannon shots render at their simulation arc height and reuse one bounded buffer', () => {
  const scene = makeScene();
  const shot = { id: 'shot-1', x: 1040, y: 880, angle: -Math.PI / 2, height: 1.78, life: 0.3 };
  scene.game.projectiles = [shot]; scene._projectileEffects();
  const buffer = scene._toyShots, matrix = new T.Matrix4();
  buffer.getMatrixAt(0, matrix);
  const position = new T.Vector3().setFromMatrixPosition(matrix);
  assert.ok(Math.abs(position.x - shot.x / 20) < 0.00001);
  assert.ok(Math.abs(position.y - shot.height) < 0.00001);
  assert.ok(Math.abs(position.z - shot.y / 20) < 0.00001);
  const original = Float32Array.from(buffer.instanceMatrix.array);
  scene._projectileEffects();
  assert.deepEqual(Array.from(buffer.instanceMatrix.array), Array.from(original), 'paused simulation produces the same shot transforms');
  const geometryCount = scene._geometries.length, materialCount = scene._materials.size;
  for (let i = 0; i < 100; i++) {
    scene.game.projectiles = i % 2 ? [] : [shot]; scene._projectileEffects();
    assert.equal(scene._toyShots, buffer);
    assert.equal(buffer.count, i % 2 ? 0 : 1);
    assert.equal(buffer.visible, i % 2 === 0);
  }
  scene.game.projectiles = Array.from({ length: 40 }, (_, i) => ({ ...shot, id: 'shot-' + i }));
  scene._projectileEffects(); assert.equal(buffer.count, 32);
  assert.equal(scene._geometries.length, geometryCount);
  assert.equal(scene._materials.size, materialCount);
});

test('garage paint recolors the entire body while preserving trim, other cars, and geometry', () => {
  const scene = makeScene(), [car, neighbor] = scene.game.cars;
  car.color = neighbor.color = '#ffd15b';
  scene.game.cars = [car, neighbor]; scene.game.police = [];
  scene._cars(0);
  const model = scene._vehicles.get(car.id), other = scene._vehicles.get(neighbor.id);
  const geometry = model.paint.mesh.geometry, before = Float32Array.from(geometry.attributes.color.array);
  const geometryCount = scene._geometries.length;
  car.color = '#fb8097'; scene._cars(0);
  assert.equal(model.color, car.color); assert.equal(model.shell.material, model.body);
  assert.equal(model.body.color.getHexString(), 'fb8097');
  assert.equal(other.body.color.getHexString(), 'ffd15b', 'a shared old color material is not mutated');
  assert.equal(model.paint.mesh.geometry, geometry, 'repainting retains merged geometry');
  const paintIndices = new Set();
  for (const range of model.paint.ranges) for (let i = range.start; i < range.start + range.count; i++) paintIndices.add(i);
  assert.ok(paintIndices.size > 0, 'the merged roof and panels have tracked paint vertices');
  const colors = geometry.attributes.color;
  for (let i = 0; i < colors.count; i++) {
    if (paintIndices.has(i)) {
      assert.ok(Math.abs(colors.getX(i) - model.body.color.r) < 0.000001);
      assert.ok(Math.abs(colors.getY(i) - model.body.color.g) < 0.000001);
      assert.ok(Math.abs(colors.getZ(i) - model.body.color.b) < 0.000001);
    } else {
      assert.equal(colors.getX(i), before[i * 3]);
      assert.equal(colors.getY(i), before[i * 3 + 1]);
      assert.equal(colors.getZ(i), before[i * 3 + 2]);
    }
  }
  for (let i = 0; i < 50; i++) {
    car.color = i % 2 ? '#67d3c8' : '#a6a0fa'; scene._cars(0);
  }
  assert.equal(scene._geometries.length, geometryCount);
  assert.equal(scene._vehicles.get(car.id), model);
  car.health = 0; car.color = '#6fb5eb'; scene._cars(0);
  assert.equal(model.shell.material.color.getHexString(), '8f9aa1');
  car.health = 100; scene._cars(0);
  assert.equal(model.shell.material.color.getHexString(), '6fb5eb', 'repaired cars show their selected paint');
});
