'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const World = require('../world.js');
const { VehicleWorld } = require('../vehicle-physics.js');
const { CAR_TYPES } = require('../vehicle-stats.js');
const C = require('../vendor/cannon.cjs');

const context = vm.createContext({ MayhemCore: { SIZE: World.SIZE }, console, AbortController });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scene3d.js'), 'utf8'), context);
const { THREE: T, MayhemScene: Scene3D } = context;
const world = World.createWorld();
const northernRoads = world.roads.filter(road => road.district === 'military');

function makeScene(roads = world.roads) {
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, { T, game: { world, roads, buildings: world.buildings }, scene: new T.Scene(),
    _geometries: [], _materials: new Map(), _staticParts: new Map(), _worldInfo: { landscape: {} },
    _dummy: new T.Object3D(), _ray: new T.Raycaster(), camera: { far: 950 }, reducedMotion: false,
    _buildingVolumes: [], _buildingFrames: new Map() });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  return scene;
}
function landscapeScene() {
  const scene = makeScene(); scene._landscape(world.size / 20); scene.scene.updateMatrixWorld(true); return scene;
}
function near(actual, expected, message, tolerance = .00025) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} versus ${expected}`);
}

test('actual expanded terrain renders the full rectangular north grid at its guarded origin', () => {
  const scene = landscapeScene(), field = world.terrain;
  const geometry = scene._terrainMesh.geometry, vertices = geometry.attributes.position, indices = geometry.index;
  assert.ok(field.minY < 0 && field.originY < field.minY, 'the playable border lies inside the guarded north grid');
  assert.notEqual(field.rows, field.count);
  assert.equal(vertices.count, field.count * field.rows);
  assert.equal(indices.count, (field.count - 1) * (field.rows - 1) * 6);
  for (let i = 0; i < vertices.count; i++) {
    near(vertices.getX(i) * 20, field.originX + i % field.count * field.step, `vertex ${i} map X`, .001);
    near(vertices.getZ(i) * 20, field.originY + Math.floor(i / field.count) * field.step, `vertex ${i} map Y`, .001);
    assert.equal(vertices.getY(i), field.heights[i]);
  }
  const oldZeroRow = -field.originY / field.step;
  assert.equal(Number.isInteger(oldZeroRow), true);
  near(vertices.getZ(oldZeroRow * field.count), 0, 'the original city seam stays at zero');
  for (const [col, row] of [[0, 0], [64, 32], [128, oldZeroRow], [field.count - 2, field.rows - 2]]) {
    const index = row * field.count + col, first = (row * (field.count - 1) + col) * 6;
    assert.deepEqual(Array.from(indices.array.slice(first, first + 6)), [index, index + field.count, index + 1, index + field.count + 1, index + 1, index + field.count]);
  }
  near(vertices.getZ(0) * 20, field.originY, 'guard row is rendered north of the playable edge');
  near(vertices.getZ(vertices.count - 1) * 20, field.originY + (field.rows - 1) * field.step, 'last guard row covers the actual southern edge');
});

test('north-edge, airbase and access-road rays agree between rendered triangles, exact traversal and Cannon', () => {
  const scene = landscapeScene(), field = world.terrain, base = world.militaryBase;
  const physics = new VehicleWorld({ world: { ...world, roads: [] }, terrain: field, roads: [], cars: [], police: [], buildings: [], staticObjects: [] }, CAR_TYPES);
  const target = new T.Vector3();
  const samples = [[0, -4000], [1, -3999], [11999, -3999], [12000, -4000], [1, 7999], [11999, 7999],
    [base.runways[0].x + 200, base.runways[0].y + base.runways[0].h / 2],
    [base.runways[0].x + base.runways[0].w - 200, base.runways[0].y + base.runways[0].h / 2],
    [base.storageStands[0].x, base.storageStands[0].y], [base.gate.x, base.gate.y],
    [6200, -.01], [6200, 0], [6200, .01]];
  for (const road of northernRoads) {
    const p = road.points[Math.floor(road.points.length / 2)]; samples.push([p.x, p.y]);
  }
  for (const [x, y] of samples) {
    scene._ray.set(new T.Vector3(x / 20, 120, y / 20), new T.Vector3(0, -1, 0));
    const rendered = scene._ray.intersectObject(scene._terrainMesh)[0];
    assert.ok(rendered, `continuous rendered ground at ${x},${y}`);
    assert.equal(scene._terrainRayPoint(target), true, `exact terrain hit at ${x},${y}`);
    assert.ok(target.distanceTo(rendered.point) < .00025, `aim and rendered grid agree at ${x},${y}`);
    near(rendered.point.y, field.heightAt(x, y), `sampled height at ${x},${y}`);
    // Perimeter walls own the exact east/west boundary. Compare Cannon's
    // floor one millimetre inside those walls, avoiding an edge-only ray.
    const physicalX = Math.max(.02, Math.min(world.bounds.maxX - .02, x));
    let physical = null;
    physics.world.raycastAll(new C.Vec3(physicalX / 20, 120, y / 20), new C.Vec3(physicalX / 20, -100, y / 20), { skipBackfaces: true }, hit => {
      if (hit.body === physics.floor) physical = hit.hitPointWorld.y;
    });
    assert.notEqual(physical, null, `real Cannon floor hit at ${x},${y}`);
    scene._ray.set(new T.Vector3(physicalX / 20, 120, y / 20), new T.Vector3(0, -1, 0));
    const physicalRendered = scene._ray.intersectObject(scene._terrainMesh)[0]; assert.ok(physicalRendered);
    near(physicalRendered.point.y, physical, `Cannon and rendered ground agree at ${x},${y}`);
  }
  for (const [x, y, dx, dy] of [[3000, -3500, .4, .6], [6000, -2400, -.5, .2], [7000, -1000, -.6, -.3], [6200, -50, .2, .4]]) {
    scene._ray.set(new T.Vector3(x / 20, 100, y / 20), new T.Vector3(dx, -1, dy).normalize());
    const rendered = scene._ray.intersectObject(scene._terrainMesh)[0]; assert.ok(rendered);
    assert.equal(scene._terrainRayPoint(target), true);
    assert.ok(target.distanceTo(rendered.point) < .00025, `oblique traversal agrees in the north at ${x},${y}`);
  }
  scene._ray.set(new T.Vector3(200, 100, -150), new T.Vector3(0, 1, 0));
  assert.equal(scene._terrainRayPoint(target), false, 'upward north shots remain sky shots');
  scene._ray.set(new T.Vector3(200, 100, field.originY / 20 - 1), new T.Vector3(0, -1, 0));
  assert.equal(scene._terrainRayPoint(target), false, 'the exact ray rejects points beyond the north guard row');
});

test('all northern road and pavement faces follow the actual terrain triangles without grass clipping', () => {
  const scene = makeScene(northernRoads), field = world.terrain; scene._roads();
  assert.ok(northernRoads.length >= 6);
  for (const [name, lifts] of [['Curved roads', [.043, .054]], ['Continuous sidewalks', [.032, .033]], ['Curb edges', [.051]]]) {
    const mesh = scene._roadGroup.getObjectByName(name), positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
    assert.ok(indices.count > 300, `${name} is tessellated over the north grid`);
    let northFaces = 0;
    for (let i = 0; i < indices.count; i += 3) {
      const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
      for (const weights of [[1 / 3, 1 / 3, 1 / 3], [.2, .5, .3]]) {
        const point = axis => ids.reduce((sum, id, j) => sum + positions['get' + axis](id) * weights[j], 0);
        const x = point('X'), y = point('Y'), z = point('Z'), ground = field.surfaceHeight(x * 20, z * 20);
        assert.ok(lifts.some(lift => Math.abs(y - ground - lift) < .0005), `${name} face ${i / 3} follows its physical triangle`);
        assert.ok(y > ground + .025, `${name} remains visibly above ground`);
        if (z < 0) northFaces++;
      }
    }
    assert.ok(northFaces > 300, `${name} includes the negative north coordinate range`);
  }
});

test('road ribbons cover every north access segment and junction continuously across the original city seam', () => {
  const scene = makeScene(northernRoads), field = world.terrain; scene._roads(); scene.scene.updateMatrixWorld(true);
  const asphalt = scene._roadGroup.getObjectByName('Curved roads');
  let checks = 0, northChecks = 0, southChecks = 0;
  for (const road of northernRoads) for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], span = Math.hypot(b.x - a.x, b.y - a.y);
    if (span < .01) continue;
    const nx = -(b.y - a.y) / span, ny = (b.x - a.x) / span;
    for (const t of [0, .25, .5, .75, 1]) for (const side of [-.4, 0, .4]) {
      const x = a.x + (b.x - a.x) * t + nx * road.width * side;
      const y = a.y + (b.y - a.y) * t + ny * road.width * side;
      const ground = field.surfaceHeight(x, y);
      scene._ray.set(new T.Vector3(x / 20, ground + 20, y / 20), new T.Vector3(0, -1, 0));
      const hit = scene._ray.intersectObject(asphalt)[0];
      assert.ok(hit, `${road.id} segment ${i - 1} at ${t},${side} has no ribbon gap`);
      assert.ok([.043, .054].some(lift => Math.abs(hit.point.y - ground - lift) < .0005), `${road.id} stays on the surface at every cross-section`);
      checks++; if (y < 0) northChecks++; else southChecks++;
    }
  }
  assert.ok(checks > 500 && northChecks > 300 && southChecks > 50, 'coverage samples include both sides of the unchanged city seam');
});
