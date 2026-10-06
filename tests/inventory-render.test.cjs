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
    reducedMotion: false
  });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  scene._sphere = scene._geometry(new T.IcosahedronGeometry(1, 1));
  scene._cylinder = scene._geometry(new T.CylinderGeometry(1, 1, 1, 10));
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
