'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');

const context = vm.createContext({ MayhemCore: core, MayhemWorld: require('../world.js'), MayhemPhysics: require('../physics.js'), console, AbortController });
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
  game.peds = [];
  const base = game.world.terrain.surfaceHeight(game.player.x, game.player.y);
  assert.equal(game.jump(), true);
  let apex = 0;
  for (let frame = 0; frame < 90; frame++) {
    game.update(1 / 60, {}); scene._people(1 / 60);
    assert.ok(Math.abs(scene._player.group.position.y - game.player.elevation - 0.03) < 0.000001);
    apex = Math.max(apex, scene._player.group.position.y);
    assert.equal(scene._player.group.visible, true);
  }
  assert.ok(apex - base > 1.3, 'jump has a clearly visible arc above the elevated street');
  assert.equal(game.player.grounded, true);
  assert.ok(Math.abs(scene._player.group.position.y - game.world.terrain.surfaceHeight(game.player.x, game.player.y) - .03) < .01);
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
    const cosine = Math.cos(object.angle || 0), sine = Math.sin(object.angle || 0);
    assert.ok(Math.abs(mesh.position.x - object.x / 20 - cosine * part.offset[0] + sine * part.offset[2]) < 0.000001);
    assert.ok(Math.abs(mesh.position.y - (object.elevation || 0) - part.offset[1]) < 0.000001);
    assert.ok(Math.abs(mesh.position.z - object.y / 20 - sine * part.offset[0] - cosine * part.offset[2]) < 0.000001);
    assert.ok(Math.abs(mesh.rotation.y + (object.angle || 0)) < 0.000001);
    const bounds = new T.Box3().setFromObject(mesh, true), size = bounds.getSize(new T.Vector3());
    assert.ok(Math.abs(size.y - part.half[1] * 2) < 0.00001, 'visual collider height uses the map shape');
    const expectedWidth = part.shape === 'cylinder'
      ? Math.max(...Array.from({ length: 12 }, (_, i) => Math.abs(cosine * Math.sin(i / 12 * Math.PI * 2) * part.half[0] - sine * Math.cos(i / 12 * Math.PI * 2) * part.half[2]))) * 2
      : (Math.abs(cosine) * part.half[0] + Math.abs(sine) * part.half[2]) * 2;
    assert.ok(Math.abs(size.x - expectedWidth) < 0.025, 'rotated visible cylinder/box uses the physical footprint');
  }
});

test('people use the shared smaller scale while vehicles keep their original dimensions', () => {
  const scene = makeScene(), physics = require('../physics.js');
  assert.ok(Math.abs(scene._player.group.scale.x - physics.CHARACTER_SCALE) < 0.000001);
  const personBounds = new T.Box3().setFromObject(scene._player.group), personSize = personBounds.getSize(new T.Vector3());
  assert.ok(Math.abs(personSize.y - physics.PERSON_HEIGHT) < 0.04, 'visible stature matches physical stature plus hat: ' + personSize.y);
  scene._cars(0);
  const model = scene._vehicles.get(scene.game.cars[0].id);
  assert.equal(model.group.scale.x, 1);
  assert.equal(model.visual.scale.x, 1);
});

test('district facades follow real footprints and cottage roofs face outward', () => {
  const scene = makeScene();
  scene._staticParts = new Map(); scene._buildingVolumes = []; scene._buildingFrames = new Map(); scene._sign = () => {};
  const styles = new Set();
  scene.game.buildings.forEach((building, i) => { styles.add(building.style); scene._building(building, i); });
  assert.equal(scene._buildingVolumes.length, scene.game.buildings.length);
  assert.ok(styles.has('cottage') && styles.has('warehouse') && styles.has('shop') && styles.has('cafe'));
  scene.game.buildings.forEach((building, i) => {
    const volume = scene._buildingVolumes[i];
    assert.ok(Math.abs(volume.cx - (building.x + building.w / 2) / 20) < 0.000001);
    assert.ok(Math.abs(volume.cz - (building.y + building.h / 2) / 20) < 0.000001);
    assert.ok(Math.abs(volume.halfX - building.w / 40 - 0.12) < 0.000001);
    assert.ok(Math.abs(volume.halfZ - building.h / 40 - 0.12) < 0.000001);
    assert.equal(volume.angle, building.angle || 0);
    assert.ok(Math.abs(volume.maxY - building.elevation - building.height - 0.45) < 0.000001);
    assert.ok(Math.abs(volume.minY - building.foundationBottom + .2) < .000001);
    const frame = scene._buildingFrames.get(building.id);
    assert.equal(frame.yaw, -(building.angle || 0));
    assert.ok(Math.abs(Math.atan2(frame.front.z - volume.cz, frame.front.x - volume.cx) - building.frontAngle) < 0.000001);
  });
  const normals = scene._roofGeometry().attributes.normal;
  for (let vertex = 0; vertex < 12; vertex++) assert.ok(normals.getY(vertex) > 0, 'roof slopes are visible from above');
  assert.ok(normals.getZ(12) < 0 && normals.getZ(15) > 0, 'gable faces point outward');
  const rotated = scene.game.buildings.find(b => Math.abs(Math.sin(2 * b.angle)) > .2);
  assert.ok(rotated, 'the physical map contains diagonal frontages');
  scene._staticParts.clear();
  scene._building(rotated, 0);
  const wall = scene._staticParts.values().next().value.parts[0];
  const corners = require('../world.js').footprintCorners(rotated);
  for (const [i, local] of [[0, [-.5, -.5]], [1, [.5, -.5]], [2, [.5, .5]], [3, [-.5, .5]]]) {
    const actual = new T.Vector3(local[0], 0, local[1]).applyMatrix4(wall.matrix);
    assert.ok(Math.hypot(actual.x - corners[i].x / 20, actual.z - corners[i].y / 20) < .000001, 'actual batched wall vertices match the rotated physical footprint');
  }
});

test('curved road surfaces and continuous sidewalks follow the shared graph in three batches', () => {
  const scene = makeScene();
  scene._staticParts = new Map(); scene._worldInfo = { districts: {}, landscape: {} };
  scene._roads();
  assert.equal(scene._roadGroup.children.length, 3, 'the whole road graph uses only three surface draws');
  assert.equal(scene.worldInfo.roads, scene.game.roads.length);
  assert.ok(scene.worldInfo.curvedRoads > 10 && scene.worldInfo.suburbanHomes > 25);
  assert.equal(scene.worldInfo.worldSize, core.SIZE / 20);
  const asphalt = scene._roadGroup.getObjectByName('Curved roads'), sidewalk = scene._roadGroup.getObjectByName('Continuous sidewalks');
  const ray = new T.Raycaster();
  let checked = 0;
  scene._roadGroup.updateMatrixWorld(true);
  for (const mesh of scene._roadGroup.children) {
    const normals = mesh.geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) assert.ok(normals.getY(i) > 0, 'sloped road surfaces face upward');
  }
  for (const road of scene.game.roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], heading = Math.atan2(b.y - a.y, b.x - a.x);
      const x = (a.x + b.x) / 40, z = (a.y + b.y) / 40;
      ray.set(new T.Vector3(x, scene._surfaceY(x, z) + 100, z), new T.Vector3(0, -1, 0));
      assert.ok(ray.intersectObject(asphalt).length > 0, 'actual road mesh covers every graph segment');
      const side = road.width / 40 + scene.worldInfo.sidewalkWidth / 2;
      ray.set(new T.Vector3(x - Math.sin(heading) * side, scene._surfaceY(x, z) + 100, z + Math.cos(heading) * side), new T.Vector3(0, -1, 0));
      assert.ok(ray.intersectObject(sidewalk).length > 0, 'sidewalk extends continuously outside the road edge');
      checked++;
    }
  }
  assert.ok(checked > 150);
});

test('the playable map renders its shared hills, coast and actual supported river crossings', () => {
  const scene = makeScene();
  scene._staticParts = new Map(); scene._worldInfo = { districts: {}, landscape: {} };
  scene._landscape(core.SIZE / 20);
  const terrain = scene._landscapeGroup.getObjectByName('Shared heightmap');
  assert.ok(terrain?.isMesh && terrain.geometry.index.count > 10000);
  const vertices = terrain.geometry.attributes.position;
  let low=Infinity, high=-Infinity;
  for(let i=0;i<vertices.count;i++){ low=Math.min(low,vertices.getY(i));high=Math.max(high,vertices.getY(i)); }
  assert.ok(high-low > 5, 'the backdrop has true height variation');
  assert.equal(vertices.count, scene.game.world.terrain.count ** 2);
  const water = scene._riverGroup.getObjectByName('Coastal water');
  assert.ok(water?.isMesh);
  assert.equal(water.position.y, 0);
  assert.ok(scene.worldInfo.landscape.waterGlints > 100);
  scene._bridges();
  assert.equal(scene.worldInfo.bridges.roads, scene.game.roads.filter(road => road.bridge).length);
  assert.ok(scene._bridgePiers.count > 0);
  scene.reducedMotion=true;scene._landscapeStep(0);
  const calm=Array.from(scene._riverFlow.instanceMatrix.array);scene._landscapeStep(20);
  assert.deepEqual(Array.from(scene._riverFlow.instanceMatrix.array),calm,'calm motion holds water glints still');
  scene.reducedMotion=false;scene._landscapeStep(20);
  assert.notDeepEqual(Array.from(scene._riverFlow.instanceMatrix.array),calm,'full motion gently moves glints downstream');
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
  assert.ok(Math.abs(position.y - scene._surfaceY(54, 54) - .2) < .00001);
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
