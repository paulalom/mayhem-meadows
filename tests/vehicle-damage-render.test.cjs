'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');
const VehicleStats = require('../vehicle-stats.js');

const context = vm.createContext({ MayhemCore: core, MayhemVehicleStats: VehicleStats, console, AbortController });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scene3d.js'), 'utf8'), context);
const { THREE: T, MayhemScene: Scene3D } = context;

const car = (id = 'car-test', kind = 'compact') => ({ id, kind, color: '#ffd15b', x: 1000, y: 1000, angle: 0,
  speed: 0, health: 100, maxHealth: 100, engineHealth: 100, handlingHealth: 100, burning: false, exploded: false });

function makeScene(cars = [car()], police = []) {
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, { T, game: { cars, police, time: 0, heat: 1 }, scene: new T.Scene(),
    _geometries: [], _materials: new Map(), _vehicles: new Map(), _color: new T.Color(), reducedMotion: false });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  scene._cylinder = scene._geometry(new T.CylinderGeometry(1, 1, 1, 12));
  scene._sphere = scene._geometry(new T.IcosahedronGeometry(1, 1));
  scene._cone = scene._geometry(new T.ConeGeometry(1, 1, 7));
  scene._cars(0);
  return scene;
}

const colors = model => Array.from(model.paint.mesh.geometry.attributes.color.array);
const matrices = mesh => Array.from(mesh.instanceMatrix.array);

test('damage progressively crumples every body type and repair restores shape, windows, and wheels', () => {
  for (const kind of ['compact', 'sports', 'van']) {
    const vehicle = car('car-' + kind, kind), scene = makeScene([vehicle]), model = scene._vehicles.get(vehicle.id);
    const pristine = colors(model), geometry = model.paint.mesh.geometry;
    const originalShell = model.shell.scale.clone(), originalHood = model.hood.position.clone();
    vehicle.health = 75; vehicle.handlingHealth = 75; scene._cars(0);
    const lightDamage = model.shell.scale.x, lightHood = model.hood.rotation.z;
    assert.ok(lightDamage < originalShell.x, 'quarter damage already changes the body silhouette');
    vehicle.health = 25; vehicle.handlingHealth = 20; scene._cars(0);
    assert.ok(model.shell.scale.x < lightDamage && model.hood.rotation.z > lightHood);
    assert.ok(model.bumpers[0].rotation.y < 0 && model.bumpers[0].position.y < 0.44);
    assert.ok(model.windows.material.color.r < model.originals[2].material.color.r);
    assert.equal(model.cracks.visible, true);
    assert.notEqual(model.wheels[0].rotation.y, 0, 'damaged suspension leaves visibly bent wheels');
    VehicleStats.repair(vehicle); scene._cars(0);
    for (const original of model.originals) {
      assert.ok(original.mesh.position.equals(original.position));
      assert.ok(original.mesh.scale.equals(original.scale));
      assert.ok(original.mesh.rotation.equals(original.rotation));
    }
    assert.ok(model.hood.position.equals(originalHood));
    assert.equal(model.shell.material, model.body); assert.equal(model.hood.material, model.body);
    assert.equal(model.cracks.visible, false); assert.equal(model.wheels[0].rotation.y, 0);
    assert.deepEqual(colors(model), pristine, 'repair restores the original merged paint and trim exactly');
    assert.equal(model.paint.mesh.geometry, geometry);
  }
});

test('scorch and repaint stay isolated to the damaged car and its tracked paint ranges', () => {
  const vehicle = car(), neighbor = car('neighbor'), scene = makeScene([vehicle, neighbor]);
  const model = scene._vehicles.get(vehicle.id), other = scene._vehicles.get(neighbor.id);
  const cleanNeighbor = colors(other), cleanTrim = Float32Array.from(model.baseColors);
  vehicle.health = 30; vehicle.burning = true; vehicle.fireTime = 4; scene._cars(0);
  assert.notEqual(model.shell.material, other.shell.material);
  assert.ok(model.shell.material.color.r < other.shell.material.color.r);
  assert.deepEqual(colors(other), cleanNeighbor, 'shared original materials never acquire another car\'s scorch');
  vehicle.color = '#6fb5eb'; scene._cars(0);
  VehicleStats.repair(vehicle); scene._cars(0);
  const paintIndices = new Set();
  for (const range of model.paint.ranges) for (let i = range.start; i < range.start + range.count; i++) paintIndices.add(i);
  const attribute = model.paint.mesh.geometry.attributes.color;
  for (let i = 0; i < attribute.count; i++) {
    if (paintIndices.has(i)) assert.ok(Math.abs(attribute.getX(i) - model.body.color.r) < 0.000001);
    else assert.equal(attribute.getX(i), cleanTrim[i * 3], 'repaint preserves unpainted trim after scorch is repaired');
  }
  assert.equal(model.shell.material.color.getHexString(), '6fb5eb');
  assert.equal(other.body.color.getHexString(), 'ffd15b');
});

test('critical engines smoke and a burning vehicle has continuous animated flames which calm with reduced motion', () => {
  const vehicle = car(), scene = makeScene([vehicle]), model = scene._vehicles.get(vehicle.id), effect = model.effects;
  vehicle.engineHealth = 20; scene._cars(0);
  assert.equal(effect.group.visible, true); assert.equal(effect.smoke.count, 8); assert.equal(effect.flames.count, 0);
  vehicle.burning = true; scene._cars(0);
  assert.equal(effect.flames.visible, true); assert.equal(effect.flames.count, 12);
  const first = matrices(effect.flames); scene.game.time = 0.24; scene._cars(0);
  assert.notDeepEqual(matrices(effect.flames), first, 'persistent flames animate with simulation time');
  const paused = matrices(effect.flames); scene._cars(0);
  assert.deepEqual(matrices(effect.flames), paused, 'paused simulation holds fire still');
  scene.reducedMotion = true; scene._cars(0);
  const calmFlames = matrices(effect.flames), calmSmoke = matrices(effect.smoke);
  scene.game.time = 8; scene._cars(0);
  assert.deepEqual(matrices(effect.flames), calmFlames); assert.deepEqual(matrices(effect.smoke), calmSmoke);
  assert.equal(effect.flames.count, 12, 'reduced motion preserves the visible fire warning');
  VehicleStats.repair(vehicle); scene._cars(0);
  assert.equal(effect.group.visible, false); assert.equal(effect.smoke.count, 0); assert.equal(effect.flames.count, 0);
});

test('explosions expand once at the blast origin, expire, and leave a charred wreck which can be repaired', () => {
  const vehicle = car(), scene = makeScene([vehicle]), model = scene._vehicles.get(vehicle.id), effect = model.effects;
  vehicle.exploded = true; vehicle.health = 0; vehicle.explosionTime = 0; scene._cars(0);
  assert.equal(effect.flash.visible, true); assert.equal(effect.smoke.count, 4);
  assert.ok(model.shell.material.color.r < 0.1, 'exploded chassis has persistent charcoal paint');
  const radius = effect.flash.scale.x, origin = effect.group.position.clone();
  vehicle.x += 180; scene.game.time = 0.3; scene._cars(0);
  assert.ok(effect.flash.scale.x > radius); assert.ok(effect.group.position.equals(origin), 'the one-time blast stays where the explosion occurred');
  scene.game.time = 3; scene._cars(0);
  assert.equal(effect.group.visible, false); assert.equal(effect.flash.visible, false); assert.equal(effect.smoke.count, 0);
  scene.game.time = 4; scene._cars(0); assert.equal(effect.group.visible, false, 'an old explosion never restarts each frame');
  VehicleStats.repair(vehicle); delete vehicle.explosionTime; scene._cars(0);
  assert.equal(model.shell.material, model.body); assert.equal(model.shell.material.color.getHexString(), 'ffd15b');
});

test('police receive the same damage, flames, scorch and repairs without altering physical orientation', () => {
  const cop = car('police-test'), scene = makeScene([], [cop]), model = scene._vehicles.get(cop.id);
  const orientation = new T.Quaternion().setFromEuler(new T.Euler(0.5, -0.7, 1.2));
  cop.orientation = { x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w };
  cop.elevation = 3; cop.health = 18; cop.engineHealth = 10; cop.burning = true; scene._cars(0);
  assert.ok(1 - Math.abs(model.group.quaternion.dot(orientation)) < 0.000001);
  assert.equal(model.effects.flames.count, 12); assert.equal(model.cracks.visible, true);
  model.effects.group.updateMatrixWorld(true);
  assert.ok(model.effects.group.quaternion.equals(new T.Quaternion()), 'flames rise upright while the damaged chassis tumbles');
  cop.exploded = true; cop.explosionTime = scene.game.time; scene._cars(0);
  assert.equal(model.red.visible, false); assert.equal(model.blue.visible, false);
  VehicleStats.repair(cop); scene._cars(0);
  assert.equal(model.red.visible, true); assert.equal(model.blue.visible, true);
  assert.equal(model.shell.material.color.getHexString(), 'eff1de');
  assert.ok(1 - Math.abs(model.group.quaternion.dot(orientation)) < 0.000001);
});

test('damage, fire, smoke and repeated explosions reuse bounded geometry, materials and instance buffers', () => {
  const vehicle = car(), scene = makeScene([vehicle]), model = scene._vehicles.get(vehicle.id), effect = model.effects;
  const geometries = scene._geometries.length, materials = scene._materials.size, children = scene.scene.children.length;
  const bodyGeometry = model.paint.mesh.geometry, flames = effect.flames, smoke = effect.smoke, flashMaterial = effect.flash.material;
  for (let i = 0; i < 180; i++) {
    Object.assign(vehicle, { health: i % 100, engineHealth: i % 50, burning: i % 3 === 0, fireTime: i / 10,
      exploded: i % 7 === 0, explosionTime: i / 60 });
    scene.game.time = i / 60; scene._cars(1 / 60);
    assert.ok(effect.flames.count <= 12 && effect.smoke.count <= 12);
    assert.equal(model.paint.mesh.geometry, bodyGeometry); assert.equal(effect.flames, flames); assert.equal(effect.smoke, smoke);
    assert.equal(effect.flash.material, flashMaterial);
  }
  assert.equal(scene._geometries.length, geometries); assert.equal(scene._materials.size, materials);
  assert.equal(scene.scene.children.length, children);
  scene.game.cars = []; scene._cars(0);
  assert.equal(model.group.visible, false); assert.equal(effect.group.visible, false, 'removed cars leave no orphan flame or smoke');
});

test('replacing cars and patrols retires owned resources while shared shapes and a surviving car stay intact', () => {
  const survivor = car('survivor'), scene = makeScene([survivor]);
  // Warm the patrol palette so the material total only measures owned resources.
  scene.game.police = [car('police-warmup')]; scene._cars(0);
  scene.game.police = []; scene._cars(0);
  const permanent = scene._vehicles.get(survivor.id), pristine = colors(permanent);
  const geometries = scene._geometries.length, materials = scene._materials.size, groups = scene.scene.children.length;
  const sharedGeometry = [scene._cube, scene._cylinder, scene._cone, scene._sphere];
  const sharedMaterial = [permanent.body, permanent.paint.mesh.material, permanent.effects.flames.material, permanent.effects.smoke.material];
  let sharedDisposals = 0;
  for (const resource of sharedGeometry.concat(sharedMaterial)) resource.addEventListener('dispose', () => sharedDisposals++);
  for (let cycle = 0; cycle < 35; cycle++) {
    const replacement = car('replacement-' + cycle), patrol = car('police-replacement-' + cycle);
    scene.game.cars = [survivor, replacement]; scene.game.police = [patrol]; scene._cars(0);
    const removed = [scene._vehicles.get(replacement.id), scene._vehicles.get(patrol.id)];
    const counts = { geometries: 0, materials: 0, instances: 0 };
    for (const model of removed) {
      for (const geometry of model.geometries) geometry.addEventListener('dispose', () => counts.geometries++);
      for (const material of [model.damageBody, model.damageGlass, model.damageTrim, model.effects.flash.material]) {
        material.addEventListener('dispose', () => counts.materials++);
      }
      model.effects.flames.addEventListener('dispose', () => counts.instances++);
      model.effects.smoke.addEventListener('dispose', () => counts.instances++);
    }
    replacement.health = 8; replacement.burning = true; patrol.exploded = true; patrol.explosionTime = scene.game.time;
    scene._cars(0);
    scene.game.cars = [survivor]; scene.game.police = []; scene._cars(0);
    assert.equal(scene._vehicles.size, 1); assert.equal(scene._vehicles.get(survivor.id), permanent);
    assert.equal(scene._geometries.length, geometries); assert.equal(scene._materials.size, materials);
    assert.equal(scene.scene.children.length, groups);
    assert.equal(counts.geometries, removed.reduce((sum, model) => sum + model.geometries.length, 0));
    assert.equal(counts.materials, 8); assert.equal(counts.instances, 4);
    for (const model of removed) {
      assert.equal(model.group.parent, null); assert.equal(model.effects.group.parent, null);
      for (const geometry of model.geometries) assert.equal(scene._geometries.includes(geometry), false);
    }
    assert.deepEqual(colors(permanent), pristine, 'retiring a neighbor leaves surviving paint buffers intact');
  }
  assert.equal(sharedDisposals, 0, 'retirement never disposes common shapes, paint, or effects materials');
  survivor.color = '#6fb5eb'; survivor.health = 25; scene._cars(0);
  VehicleStats.repair(survivor); scene._cars(0);
  assert.equal(permanent.shell.material, permanent.body); assert.equal(permanent.body.color.getHexString(), '6fb5eb');
});
