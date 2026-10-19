'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ console, AbortController });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../aircraft-models.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scene3d.js'), 'utf8'), context);
const { THREE: T, MayhemScene: Scene3D } = context;
const types = ['trainer', 'commuter', 'helicopter', 'news', 'policeheli', 'transportheli', 'fighter'];
const aircraft = (type = 'trainer', id = type) => ({ id, kind: 'aircraft', aircraftType: type, x: 1000, y: 1000,
  elevation: 30, angle: 0, pitch: 0, roll: 0, speed: 300, throttle: .8, health: 100, maxHealth: 100, flightPhase: 'cruise' });

function makeScene(entities = [aircraft()]) {
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, { T, game: { aircraft: entities, player: { x: 0, y: 0, elevation: 0 }, time: 0, cars: [], police: [] },
    scene: new T.Scene(), _geometries: [], _materials: new Map(), _aircraft: new Map(), _aircraftGeometries: new Map(),
    _vehicles: new Map(), _residents: new Map(), _buildingVolumes: [], _color: new T.Color(), _dummy: new T.Object3D(), reducedMotion: false });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  scene._cylinder = scene._geometry(new T.CylinderGeometry(1, 1, 1, 12));
  scene._sphere = scene._geometry(new T.IcosahedronGeometry(1, 1));
  scene._cone = scene._geometry(new T.ConeGeometry(1, 1, 7));
  scene._aircraftStep(0);
  return scene;
}

test('all seven Blender airframes render finite geometry with distinct silhouettes and named animated parts', () => {
  const scene = makeScene(types.map(type => aircraft(type)));
  for (const type of types) {
    const model = scene._aircraft.get(type), source = context.MayhemAircraftModels[type];
    assert.equal(model.parts.length, source.parts.length);
    assert.ok(model.parts.length >= 4, type + ' uses the authored asset');
    const bounds = new T.Box3().setFromObject(model.visual), size = bounds.getSize(new T.Vector3());
    assert.ok(size.x > 3 && size.y > 1 && size.z > 2, type + ' has useful world metre dimensions');
    for (const part of model.parts) {
      for (const value of part.mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
      assert.ok(part.mesh.geometry.attributes.normal, 'Blender mesh normals computed for lighting');
      assert.equal(part.mesh.castShadow, true);
    }
    if (type !== 'fighter') assert.ok(model.parts.some(part => part.animation), type + ' has animated propeller or rotor');
  }
  assert.ok(scene._aircraft.get('commuter').length > scene._aircraft.get('trainer').length);
  assert.ok(scene._aircraft.get('transportheli').width > scene._aircraft.get('helicopter').width);
  assert.ok(scene._aircraft.get('policeheli').searchlight);
  assert.ok(!scene._aircraft.get('news').searchlight);
});

test('yaw, nose-up pitch and right bank rotate the visual around a fixed bottom elevation', () => {
  const entity = aircraft('helicopter'), scene = makeScene([entity]), model = scene._aircraft.get(entity.id);
  entity.pitch = .28; entity.roll = .4; entity.angle = Math.PI / 2; scene._aircraftStep(1 / 60);
  assert.equal(model.group.position.y, 30);
  model.group.updateMatrixWorld(true);
  const quaternion = model.visual.getWorldQuaternion(new T.Quaternion());
  const forward = new T.Vector3(1, 0, 0).applyQuaternion(quaternion), right = new T.Vector3(0, 0, 1).applyQuaternion(quaternion);
  assert.ok(forward.y > .1 && forward.z > .8, 'nose rises while heading follows world +Y');
  assert.ok(right.y < -.1, 'a right bank lowers the right side');
  const rotor = model.parts.find(part => part.animation === 'mainRotor');
  const initial = rotor.mesh.rotation.y; scene._aircraftStep(.05);
  assert.notEqual(rotor.mesh.rotation.y, initial);
  entity.rotorAngle = 1.1; scene._aircraftStep(0); assert.equal(rotor.mesh.rotation.y, 1.1);
});

test('searchlight tracks the last sighting, side gun bursts show, and offstage flights leave no visible effects', () => {
  const entity = aircraft('policeheli'), scene = makeScene([entity]), model = scene._aircraft.get(entity.id);
  Object.assign(entity, { searchlight: true, lastSeen: { x: 1100, y: 1100, elevation: 2 }, gunFiring: true, engineHealth: 10 });
  scene.reducedMotion = true; scene._aircraftStep(0);
  assert.equal(model.searchlight.group.visible, true);
  assert.equal(model.muzzle.visible, true);
  assert.equal(model.searchlight.pool.position.x, 55);
  assert.equal(model.searchlight.pool.position.z, 55);
  assert.ok(Math.abs(model.searchlight.pool.position.y - 2.05) < 1e-8);
  assert.ok(model.searchlight.cone.scale.y > 20);
  assert.equal(model.effects.group.visible, true);
  entity.visible = false; scene._aircraftStep(0);
  assert.equal(model.group.visible, false); assert.equal(model.searchlight.group.visible, false);
  assert.equal(model.effects.group.visible, false); assert.equal(model.muzzle.visible, false);
});

test('fleet animation and replacement reuse shared mesh buffers and retire per-aircraft resources', () => {
  const survivor = aircraft('trainer'), scene = makeScene([survivor]);
  // Warm all caches; only a bounded seven-airframe geometry palette is retained.
  scene.game.aircraft = [survivor, ...types.slice(1).map(type => aircraft(type))]; scene._aircraftStep(0);
  scene.game.aircraft = [survivor]; scene._aircraftStep(0);
  const geometryCount = scene._geometries.length, materialCount = scene._materials.size, childCount = scene.scene.children.length;
  const permanent = scene._aircraft.get(survivor.id), geometry = permanent.parts[0].mesh.geometry;
  let sharedDisposed = 0; geometry.addEventListener('dispose', () => sharedDisposed++);
  for (let cycle = 0; cycle < 24; cycle++) {
    const entity = aircraft(types[cycle % types.length], 'replacement-' + cycle);
    scene.game.aircraft = [survivor, entity]; scene._aircraftStep(.1);
    const model = scene._aircraft.get(entity.id);
    let materialsDisposed = 0, instancesDisposed = 0;
    for (const entry of model.materials) entry.material.addEventListener('dispose', () => materialsDisposed++);
    for (const instance of [model.effects.flames, model.effects.smoke]) instance.addEventListener('dispose', () => instancesDisposed++);
    for (let frame = 0; frame < 6; frame++) { scene.game.time += .1; scene._aircraftStep(.1); }
    scene.game.aircraft = [survivor]; scene._aircraftStep(0);
    assert.equal(materialsDisposed, model.materials.length); assert.equal(instancesDisposed, 2);
    assert.equal(scene.scene.children.length, childCount);
    assert.equal(scene._geometries.length, geometryCount); assert.equal(scene._materials.size, materialCount);
  }
  assert.equal(sharedDisposed, 0); assert.equal(permanent.parts[0].mesh.geometry, geometry);
});

test('aerial rounds without a ground-weapon angle render at their simulated altitude using bounded buffers', () => {
  const scene = makeScene([]);
  scene.game.aircraftProjectiles = [{ id: 'round', ownerId: 'heli', x: 200, y: 300, elevation: 44, vx: 20, vy: 30, life: 1, color: '#ffc94d' }];
  scene._projectileEffects();
  assert.equal(scene._toyShots.count, 1);
  const matrix = new T.Matrix4(); scene._toyShots.getMatrixAt(0, matrix);
  assert.deepEqual(Array.from(new T.Vector3().setFromMatrixPosition(matrix).toArray()), [10, 44, 15]);
  const mesh = scene._toyShots, geometries = scene._geometries.length;
  scene.game.aircraftProjectiles = Array.from({ length: 100 }, (_, index) => ({ ...scene.game.aircraftProjectiles[0], id: 'round-' + index }));
  scene._projectileEffects(); assert.equal(mesh.count, 64); assert.equal(scene._toyShots, mesh);
  scene.game.projectiles = Array.from({ length: 40 }, (_, index) => ({ id: 'toy-' + index, x: 0, y: 0, height: 2, angle: 0, life: 1 }));
  scene._projectileEffects(); assert.equal(mesh.count, 96, 'ground shots and aircraft each retain their own visual budget');
  assert.equal(scene._geometries.length, geometries);
});

test('missiles and rockets render larger along their 3D flight direction and lock markers project target height', () => {
  const scene = makeScene([]);
  scene.game.aircraftProjectiles = ['machine-gun', 'missile', 'rocket'].map((weapon, index) => ({
    id: 'weapon-' + index, ownerId: 'jet', weapon, x: 200, y: 300, elevation: 44,
    vx: 2400, vy: 0, vz: 60, life: 1
  }));
  scene._projectileEffects();
  const matrix = new T.Matrix4(), rotation = new T.Quaternion(), position = new T.Vector3(), scale = new T.Vector3();
  scene._toyShots.getMatrixAt(0, matrix); matrix.decompose(position, rotation, scale);
  const bulletLength = scale.x;
  for (const index of [1, 2]) {
    scene._toyShots.getMatrixAt(index, matrix); matrix.decompose(position, rotation, scale);
    assert.ok(scale.x > bulletLength * 2);
    const direction = new T.Vector3(1, 0, 0).applyQuaternion(rotation);
    assert.ok(Math.abs(direction.y / direction.x - .5) < 1e-6, 'metres per second set projectile pitch');
  }
  scene.camera = new T.PerspectiveCamera(60, 1, .1, 1000);
  scene.camera.position.set(0, 10, 0); scene.camera.lookAt(0, 10, -100); scene.camera.updateMatrixWorld();
  const point = scene.weaponTargetScreenPoint({ kind: 'tank', x: 0, y: -2000, elevation: 8.8 });
  assert.ok(Math.abs(point.x - 50) < 1e-7 && Math.abs(point.y - 50) < 1e-7);
  assert.equal(scene.weaponTargetScreenPoint({ kind: 'tank', x: 0, y: 2000, elevation: 8.8 }), null);
});

test('bailout shows a reusable canopy and suspension lines, then hides on landing', () => {
  const scene = makeScene([]); Object.assign(scene.game.player, { parachuting: true, x: 600, y: 800, elevation: 50, angle: .3 });
  scene._parachuteStep();
  const canopy = scene._parachute, geometries = scene._geometries.length;
  assert.equal(canopy.visible, true); assert.equal(canopy.children.length, 5);
  assert.deepEqual(Array.from(canopy.position.toArray()), [30, 50, 40]);
  assert.ok(canopy.children[0].geometry.attributes.color);
  for (let frame = 0; frame < 10; frame++) { scene.game.time += .1; scene._parachuteStep(); }
  assert.equal(scene._parachute, canopy); assert.equal(scene._geometries.length, geometries);
  scene.game.player.parachuting = false; scene._parachuteStep(); assert.equal(canopy.visible, false);
});

test('aircraft camera keeps the horizon upright through banks with room for the full wingspan', () => {
  const entity = aircraft('commuter'), scene = makeScene([entity]);
  scene.game.current = entity; scene.game.player.vehicleId = entity.id;
  Object.assign(scene, { width: 1280, height: 720, camera: new T.PerspectiveCamera(57, 1280 / 720, .06, 3000),
    _yaw: 0, _requestedYaw: 0, _driveOffset: 0, _pitch: -.24, _viewPitch: -.24, _aiming: false, _aimBlend: 0,
    _orbitTimer: 0, _lastVehicleId: entity.id, _hasCamera: false, _cameraTarget: new T.Vector3(), _desiredCamera: new T.Vector3(),
    _lookTarget: new T.Vector3(), _viewDirection: new T.Vector3(), _sun: new T.DirectionalLight(), _cameraInfo: {} });
  scene._cameraStep(1 / 60); const before = scene.camera.quaternion.clone();
  entity.roll = 1.2; entity.pitch = .7; scene._aircraftStep(.1); scene._cameraStep(1 / 60);
  assert.equal(scene.cameraInfo.mode, 'flight'); assert.ok(scene.cameraInfo.distance > 14);
  assert.ok(1 - Math.abs(before.dot(scene.camera.quaternion)) < 1e-8, 'camera never inherits airframe bank or pitch');
  assert.equal(scene.camera.up.y, 1); assert.ok(scene.cameraInfo.fov >= 64);
});

test('aiming ray hits the elevated aircraft mesh but excludes the player aircraft and searchlight volume', () => {
  const entity = aircraft('helicopter'); Object.assign(entity, { x: 200, y: 0, elevation: 40 });
  const scene = makeScene([entity]);
  Object.assign(scene, { width: 800, height: 600, camera: new T.PerspectiveCamera(57, 4 / 3, .06, 3000), _pointer: new T.Vector2(),
    _ray: new T.Raycaster(), _aimPoint: new T.Vector3(), _aimHit: new T.Vector3(), _aimBox: new T.Box3(), _localAimRay: new T.Ray(),
    _ground: new T.Plane(new T.Vector3(0, 1, 0), 0) });
  scene.camera.position.set(0, 41.4, 0); scene.camera.lookAt(10, 41.4, 0); scene.camera.updateMatrixWorld(true);
  assert.equal(scene._aimWorldPoint(400, 300), true); assert.ok(scene._aimPoint.y > 40);
  scene.game.player.vehicleId = entity.id;
  assert.equal(scene._aimWorldPoint(400, 300), false);
});
