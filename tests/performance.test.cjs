'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTerrain } = require('../terrain.js');
const { RagdollWorld, STEP } = require('../physics.js');
const { VehicleWorld } = require('../vehicle-physics.js');
const Stats = require('../vehicle-stats.js');
const C = require('../vendor/cannon.cjs');

test('indexed bridge heights and normals match a full segment scan at cell borders and overlapping decks', () => {
  const roads = [
    [[7800, 3500], [8600, 3500], [9500, 3500]],
    [[8192, 3000], [8192, 3500], [8192, 4300]],
    [[7700, 3000], [8500, 3800], [9400, 4400]],
  ].map((points, i) => {
    const vertices = points.map(([x, y]) => ({ x, y })), arc = [0];
    for (let j = 1; j < vertices.length; j++) arc.push(arc[j - 1] + Math.hypot(vertices[j].x - vertices[j - 1].x, vertices[j].y - vertices[j - 1].y));
    return { id: 'deck-' + i, a: 'start-' + i, b: 'end-' + i, bridge: true, width: 80 + i * 20, points: vertices, arc, length: arc.at(-1) };
  });
  const terrain = createTerrain({ size: 12000, roads, buildings: [], sidewalkWidth: 32 });
  for (let x = 7424; x <= 9728; x += 32) for (let y = 2816; y <= 4608; y += 32) {
    let best;
    for (const road of roads) for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
      const distance = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
      if (distance > road.width / 2 + 34) continue;
      const height = a.elevation + (b.elevation - a.elevation) * t;
      if (!best || distance < best.distance - .000001 || Math.abs(distance - best.distance) < .000001 && height > best.height) best = { height, distance, dx, dy, length, grade: (b.elevation - a.elevation) / (length / 20) };
    }
    const ground = terrain.heightAt(x, y);
    assert.equal(terrain.surfaceHeight(x, y), Math.max(ground, best?.height ?? -Infinity));
    const normal = terrain.surfaceNormalAt(x, y);
    if (!best || best.height < ground) assert.deepEqual(normal, terrain.normalAt(x, y));
    else {
      const nx = -best.dx / best.length * best.grade, nz = -best.dy / best.length * best.grade, length = Math.hypot(nx, 1, nz);
      assert.deepEqual(normal, { x: nx / length, y: 1 / length, z: nz / length });
    }
  }
});

test('idle ragdolls preserve fractional fixed-step time before the next tumble', () => {
  const world = new RagdollWorld();
  const environment = { get buildings() { throw new Error('Idle physics must not build colliders'); } };
  assert.deepEqual(world.step(.003, environment), []);
  world.trigger({ id: 'person', x: 1000, y: 1000, angle: 0 }, { x: 2, y: 2, z: 1 });
  world.step(.004);
  assert.equal(world.get('person').age, 0);
  world.step(.002);
  assert.equal(world.get('person').age, STEP);
});

test('sparse contact history preserves collision events and motion through body removal', () => {
  const fixture = dense => {
    const cars = [1000, 1110].map((x, i) => ({ id: 'car-' + i, kind: 'compact', x, y: 1000, elevation: 0, angle: 0, speed: i ? 0 : 250, vx: i ? 0 : 250, vy: 0, health: 100 }));
    const game = { cars, police: [], buildings: [], staticObjects: [], worldSize: 5600 };
    const world = new VehicleWorld(game, Stats.CAR_TYPES);
    if (dense) { world.world.collisionMatrix = new C.ArrayCollisionMatrix(); world.world.collisionMatrixPrevious = new C.ArrayCollisionMatrix(); }
    return { game, world, events: [] };
  };
  const sparse = fixture(false), dense = fixture(true);
  for (let frame = 0; frame < 120; frame++) {
    for (const run of [sparse, dense]) {
      if (frame === 90) { run.game.cars.splice(1); run.world.sync(); }
      for (const contact of run.world.step(1 / 60)) run.events.push([frame, contact.entity.id, contact.other?.id, contact.speed]);
    }
    assert.deepEqual(sparse.game.cars, dense.game.cars);
  }
  assert.ok(sparse.events.length > 0);
  assert.deepEqual(sparse.events, dense.events);
});
