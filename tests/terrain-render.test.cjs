'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Terrain = require('../terrain.js');
const context = vm.createContext({ MayhemCore: { SIZE: 12000 }, console, AbortController });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scene3d.js'), 'utf8'), context);
const { THREE: T, MayhemScene: Scene3D } = context;

function worldWithTerrain(roads = []) {
  const world = { size: 12000, mapWidth: 12000, mapHeight: 8000, sidewalkWidth: 32, roads, buildings: [], staticObjects: [], services: [], start: {} };
  world.terrain = Terrain.createTerrain(world);
  return world;
}

function makeScene(world = worldWithTerrain()) {
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, {
    T, game: { world, roads: world.roads, buildings: world.buildings }, scene: new T.Scene(),
    _geometries: [], _materials: new Map(), _staticParts: new Map(), _worldInfo: { landscape: {} },
    _dummy: new T.Object3D(), _ray: new T.Raycaster(), camera: { far: 950 }, reducedMotion: false,
    _buildingVolumes: [], _buildingFrames: new Map()
  });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  return scene;
}

test('visible terrain uses every shared sample and the same anti-diagonal as Cannon', () => {
  const scene = makeScene(), field = scene.game.world.terrain;
  scene._landscape(600);
  const mesh = scene._terrainMesh, vertices = mesh.geometry.attributes.position, indices = mesh.geometry.index;
  assert.equal(vertices.count, field.count ** 2);
  assert.equal(indices.count, (field.count - 1) ** 2 * 6);
  assert.deepEqual(Array.from(indices.array.slice(0, 6)), [0, field.count, 1, field.count + 1, 1, field.count]);
  for (let index = 0; index < vertices.count; index++) {
    assert.equal(vertices.getY(index), field.heights[index]);
    assert.ok(Math.abs(vertices.getX(index) - index % field.count * field.step / 20) < .00005);
    assert.ok(Math.abs(vertices.getZ(index) - Math.floor(index / field.count) * field.step / 20) < .00005);
  }
  assert.ok(scene.worldInfo.landscape.maxElevation > 25);
  assert.equal(scene.worldInfo.landscape.minElevation, -3);
  const colors = mesh.geometry.attributes.color;
  const uniqueColors = new Set(Array.from({ length: colors.count }, (_, i) => [colors.getX(i), colors.getY(i), colors.getZ(i)].map(v => v.toFixed(2)).join(',')));
  assert.ok(uniqueColors.size > 25, 'coast, forest, and rocky slopes have visible material variation');
});

test('exact cell traversal ray agrees with the rendered terrain on slopes and grid boundaries', () => {
  const scene = makeScene(); scene._landscape(600); scene.scene.updateMatrixWorld(true);
  const target = new T.Vector3(), ray = scene._ray;
  for (const [x, z, dx, dz] of [[180.1, 110.3, 0, 0], [300, 175, .6, .2], [95, 55, .4, .6], [468.75, 200, -.3, 0]]) {
    ray.set(new T.Vector3(x, 85, z), new T.Vector3(dx, -1, dz).normalize());
    const hits = ray.intersectObject(scene._terrainMesh);
    assert.ok(hits.length > 0);
    assert.equal(scene._terrainRayPoint(target), true);
    assert.ok(target.distanceTo(hits[0].point) < .0002, 'grid traversal reaches the same first visible triangle');
    assert.ok(Math.abs(target.y - scene.game.world.terrain.heightAt(target.x * 20, target.z * 20)) < .0002);
  }
  ray.set(new T.Vector3(300, 85, 175), new T.Vector3(0, 1, 0));
  assert.equal(scene._terrainRayPoint(target), false, 'an unobstructed upward shot remains a sky shot');
});

test('coastal water covers the submerged ground and calm motion freezes reusable glints', () => {
  const scene = makeScene(); scene._landscape(600); scene.scene.updateMatrixWorld(true);
  scene._ray.set(new T.Vector3(570, 70, 550), new T.Vector3(0, -1, 0));
  const water = scene._ray.intersectObject(scene._riverSurface)[0], bed = scene._ray.intersectObject(scene._terrainMesh)[0];
  assert.ok(water && bed);
  assert.ok(water.distance < bed.distance);
  assert.ok(Math.abs(water.point.y) < .00001);
  assert.ok(Math.abs(bed.point.y + 3) < .00001);
  assert.ok(scene._waterGlints.length > 100);
  scene.reducedMotion = true; scene._landscapeStep(0);
  const calm = Array.from(scene._riverFlow.instanceMatrix.array);
  scene._landscapeStep(20);
  assert.deepEqual(Array.from(scene._riverFlow.instanceMatrix.array), calm);
  scene.reducedMotion = false; scene._landscapeStep(20);
  assert.notDeepEqual(Array.from(scene._riverFlow.instanceMatrix.array), calm);
});

test('road ribbons follow the shared surface and bridge undersides stay at physical deck thickness', () => {
  const points = Array.from({ length: 21 }, (_, i) => ({ x: 8400 + i * 70, y: 3000 }));
  const road = { id: 'river-test', a: 'west', b: 'east', width: 104, bridge: true, points, length: 1400, arc: points.map((_, i) => i * 70) };
  const scene = makeScene(worldWithTerrain([road])), field = scene.game.world.terrain;
  scene._roads();
  const roadMesh = scene._roadGroup.getObjectByName('Curved roads'), positions = roadMesh.geometry.attributes.position;
  for (let i = 0; i < points.length * 2; i++) {
    assert.ok(Math.abs(positions.getY(i) - field.surfaceHeight(positions.getX(i) * 20, positions.getZ(i) * 20) - .043) < .0001);
  }
  assert.equal(scene._bridgeUndersides.count, points.length - 1);
  assert.ok(scene._bridgePiers.count > 0);
  const matrix = new T.Matrix4(), center = new T.Vector3(), size = new T.Vector3(), quaternion = new T.Quaternion();
  for (let i = 0; i < scene._bridgeUndersides.count; i++) {
    scene._bridgeUndersides.getMatrixAt(i, matrix); matrix.decompose(center, quaternion, size);
    assert.ok(Math.abs(size.y - .32) < .00001);
    assert.ok(Math.abs(center.y + .16 - (points[i].elevation + points[i + 1].elevation) / 2) < .00001);
  }
  const middle = points[10];
  assert.ok(field.surfaceHeight(middle.x, middle.y) > field.heightAt(middle.x, middle.y), 'the bridge deck leaves actual lower terrain or water underneath');
});

test('wide hillside road and pavement faces match terrain throughout each face, avoiding transverse seams', () => {
  const world = worldWithTerrain();
  world.roads = [{ id: 'steep-test', a: 'a', b: 'b', width: 104, district: 'ridge', points: [{ x: 1850, y: 1200 }, { x: 2600, y: 1600 }] }];
  const scene = makeScene(world), field = world.terrain;
  scene._roads();
  for (const [name, lifts] of [['Curved roads', [.043, .054]], ['Continuous sidewalks', [.032, .033]], ['Curb edges', [.051]]]) {
    const mesh = scene._roadGroup.getObjectByName(name), positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
    assert.ok(indices.count > 300, 'the ribbon is cut at actual heightmap cells instead of spanning hills with one quad');
    for (let i = 0; i < indices.count; i += 3) {
      const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
      for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.2, .5, .3]]) {
        const x = ids.reduce((sum, id, j) => sum + positions.getX(id) * weights[j], 0);
        const y = ids.reduce((sum, id, j) => sum + positions.getY(id) * weights[j], 0);
        const z = ids.reduce((sum, id, j) => sum + positions.getZ(id) * weights[j], 0);
        // Junction fills and ribbons have separate, deliberately small offsets.
        const actualLift = y - field.surfaceHeight(x * 20, z * 20);
        assert.ok(Math.min(...lifts.map(lift => Math.abs(actualLift - lift))) < .0005);
        assert.ok(y > field.surfaceHeight(x * 20, z * 20) + .025, 'the ground cannot emerge through the road interior');
      }
    }
  }
});
