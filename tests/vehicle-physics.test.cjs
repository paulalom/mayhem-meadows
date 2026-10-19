'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CAR_TYPES } = require('../core.js');
const C = require('../vendor/cannon.cjs');
const { PERSON_HEIGHT, PLAYER_RADIUS } = require('../physics.js');
const VehicleStats = require('../vehicle-stats.js');
const { VehicleWorld } = require('../vehicle-physics.js');

const controlledWorld = (damage = {}) => {
  const ride = { id: 'controlled-car', kind: 'compact', x: 1000, y: 1000, angle: 0, speed: 0, vx: 0, vy: 0, health: 100, maxHealth: 100, engineHealth: 100, handlingHealth: 100, ...damage };
  const world = new VehicleWorld({ cars: [ride], police: [], buildings: [], staticObjects: [], worldSize: 5600 }, VehicleStats.CAR_TYPES);
  return { ride, world };
};
const driveWorld = (fixture, seconds, command) => {
  fixture.world.sync();
  for (let t = 0; t < seconds - 0.00001; t += 1 / 60) { fixture.world.control(fixture.ride, command); fixture.world.step(1 / 60); }
  return fixture.ride;
};

const empty = () => {
  const game = new Game({ seed: 42 });
  game.cars = []; game.police = []; game.peds = []; game.buildings = []; game.staticObjects = [];
  game.terrain = null; game.world = { ...game.world, terrain: null };
  game.player.x = 900; game.player.y = 900; game.graceTimer = 0;
  game.player.elevation = game.player.verticalVelocity = 0; game.player.grounded = true;
  game.vehiclePhysics.sync(); return game;
};
const stepBodies = (game, seconds, observe = () => {}) => {
  game.vehiclePhysics.sync();
  for (let t = 0; t < seconds - 0.00001; t += 1 / 60) { game.vehiclePhysics.step(1 / 60); observe(); }
};
const advance = (game, seconds, input = {}) => {
  for (let t = 0; t < seconds - 0.00001; t += 1 / 60) game.update(1 / 60, input);
};
const car = (game, x, y = 900) => game._addCar(x, y, 0, 'compact', '#ffd15b');

test('a solid building reverses real chassis velocity with an elastic bounce', () => {
  const game = empty(); game.buildings = [{ x: 1020, y: 800, w: 100, h: 200, height: 6 }];
  const ride = car(game, 900); ride.speed = ride.vx = 280;
  let bounced = false, maxHeight = 0;
  stepBodies(game, 0.8, () => { bounced ||= ride.vx < -30; maxHeight = Math.max(maxHeight, ride.elevation); });
  assert.ok(bounced, 'contact impulse must actually reverse the body velocity');
  assert.ok(ride.x < 1020 - 19); assert.ok(maxHeight > 0.15);
});

test('high-speed car impacts transfer momentum, launch both bodies, and produce roll', () => {
  const game = empty(), hitter = car(game, 900), target = car(game, 1010, 904);
  hitter.speed = hitter.vx = 360;
  let hitterHeight = 0, targetHeight = 0, targetSpeed = 0, roll = 0;
  stepBodies(game, 1.4, () => {
    hitterHeight = Math.max(hitterHeight, hitter.elevation); targetHeight = Math.max(targetHeight, target.elevation);
    targetSpeed = Math.max(targetSpeed, Math.hypot(target.vx, target.vy));
    roll = Math.max(roll, Math.abs(hitter.orientation.x) + Math.abs(hitter.orientation.z));
  });
  assert.ok(targetSpeed > 100, 'a parked car receives physical momentum');
  assert.ok(hitterHeight > 1.3, 'the fast hitter clears a car roof');
  assert.ok(targetHeight > 0.6, 'the struck car also goes airborne');
  assert.ok(roll > 0.08, 'off-centre impulse rotates the chassis');
  stepBodies(game, 3);
  assert.ok(hitter.elevation < 0.6 && target.elevation < 0.6, 'gravity brings both cars down');
});

test('gentle bumper taps transfer motion without the cartoon launch', () => {
  const game = empty(), a = car(game, 900), b = car(game, 950);
  a.speed = a.vx = 65;
  let maxHeight = 0;
  stepBodies(game, 0.7, () => { maxHeight = Math.max(maxHeight, a.elevation, b.elevation); });
  assert.ok(b.vx > 5); assert.ok(maxHeight < 0.12);
});

test('height separation prevents phantom collisions between airborne and road cars', () => {
  const game = empty(), overhead = car(game, 930), road = car(game, 900);
  overhead.elevation = 5; road.speed = road.vx = 200;
  const baseline = empty(), clearRoad = car(baseline, 900); clearRoad.speed = clearRoad.vx = 200;
  stepBodies(game, 0.15);
  stepBodies(baseline, 0.15);
  assert.ok(Math.abs(road.vx - clearRoad.vx) < 0.000001); assert.ok(overhead.elevation > 4.5);
  assert.equal(game._vehicleContact(road, overhead), null);
});

test('real roofs support a falling car and a falling player', () => {
  const game = empty(); game.buildings = [{ x: 800, y: 800, w: 200, h: 200, height: 3 }];
  const ride = car(game, 900); ride.elevation = 6;
  stepBodies(game, 1.6);
  assert.ok(Math.abs(ride.elevation - 3) < 0.04);
  game.cars = []; game.player.elevation = 5; game.player.verticalVelocity = -1; game.player.grounded = false;
  advance(game, 1);
  assert.ok(Math.abs(game.player.elevation - 3) < 0.02); assert.equal(game.player.grounded, true);
});

test('shared round lamp posts and compound benches are fixed physical objects', () => {
  const game = empty(); game.staticObjects = [
    { kind: 'lamp', x: 1010, y: 900, parts: [{ shape: 'cylinder', half: [0.075,1.9,0.075], offset: [0,1.9,0] }] },
    { kind: 'bench', x: 1200, y: 900, parts: [{ half: [0.7,0.075,0.225], offset: [0,0.44,0] }] }
  ];
  const ride = car(game, 900); ride.speed = ride.vx = 240;
  let reversed = false; stepBodies(game, 0.8, () => { reversed ||= ride.vx < -10; });
  assert.ok(reversed); assert.equal(game.vehiclePhysics.world.bodies.filter(body => body.kind === 'lamp')[0].mass, 0);
  assert.ok(Math.abs(game.vehiclePhysics.support(1200, 900, 1) - 0.515) < 0.00001);
});

test('Space jump has a useful apex, lands, and holding jump never auto-repeats', () => {
  const game = empty(); let maxHeight = 0;
  for (let i = 0; i < 90; i++) { game.update(1 / 60, { jump: true }); maxHeight = Math.max(maxHeight, game.player.elevation); }
  assert.ok(maxHeight > 1.3 && maxHeight < 1.5); assert.equal(game.player.elevation, 0); assert.equal(game.player.grounded, true);
  game.update(1 / 60, { jump: true }); assert.equal(game.player.elevation, 0);
  game.update(1 / 60, { jump: false }); game.update(1 / 60, { jump: true }); assert.ok(game.player.elevation > 0.1);
});

test('jumping onto a car roof lands on its surface and can jump off again', () => {
  const game = empty(), ride = car(game, 930);
  game.player.x = 885;
  assert.equal(game.jump(), true);
  advance(game, 0.3); advance(game, 0.22, { right: true }); advance(game, 0.6);
  assert.ok(game.player.x > 910); assert.ok(Math.abs(game.player.elevation - (ride.elevation + 1.3)) < 0.06);
  assert.equal(game.player.grounded, true); assert.equal(game.jump(), true);
});

test('jumping cannot pass through a garage lintel or an airborne underbody', () => {
  for (const underbody of [false, true]) {
    const game = empty();
    if (underbody) { const ride = car(game, 900); ride.elevation = 2.4; game.vehiclePhysics.sync(); }
    else { game.staticObjects = [{ kind: 'garage', x: 900, y: 900, parts: [{ half: [2.4,0.175,0.325], offset: [0,2.55,0] }] }]; game.vehiclePhysics.sync(); }
    game.jump(); let maxHeight = 0;
    for (let i = 0; i < 12; i++) { game.update(1 / 60); maxHeight = Math.max(maxHeight, game.player.elevation); }
    assert.ok(maxHeight < 2.4 - PERSON_HEIGHT + 0.025, 'scaled head stops below the real overhead collider');
  }
});

test('a tipped chassis uses its full orientation for standing collisions', () => {
  const game = empty(), ride = car(game, 900);
  const q = new C.Quaternion().setFromEuler(0, 0, Math.PI / 2);
  ride.orientation = { x: q.x, y: q.y, z: q.z, w: q.w }; ride.elevation = 1;
  assert.equal(game._personVehicleContact({ x: 930, y: 900, elevation: 0 }, ride, 7), null);
  assert.ok(game._personVehicleContact({ x: 915, y: 900, elevation: 1.4 }, ride, 7));
});

test('falling cars tumble residents using vertical impact speed', () => {
  const game = empty(), ride = car(game, 900); ride.elevation = PERSON_HEIGHT - 0.2; ride.verticalVelocity = -8;
  const ped = { id: 'fall-target', x: 900, y: 900, angle: 0, elevation: 0, stunned: 0, bubbleTimer: 0, pace: 0 };
  game.peds = [ped]; game._vehiclePeople(ride, 0, 0);
  assert.ok(game.ragdolls.get(ped.id));
});

test('R rights airborne flipped cars, avoids occupied roads, and preserves progression', () => {
  const game = empty(), flipped = car(game, 900), parked = car(game, 900);
  flipped.elevation = 8; flipped.orientation = { x: 1, y: 0, z: 0, w: 0 }; flipped.verticalVelocity = 3;
  game.player.vehicleId = flipped.id; game.money = 425; game.heat = 2;
  game.vehiclePhysics.sync(); game.vehiclePhysics.get(flipped.id).angularVelocity.set(2,3,4);
  game.recover(); const body = game.vehiclePhysics.get(flipped.id);
  assert.ok(Math.hypot(flipped.x - parked.x, flipped.y - parked.y) >= 46);
  assert.equal(flipped.elevation, 0); assert.equal(flipped.upright, true); assert.equal(body.velocity.length(), 0); assert.equal(body.angularVelocity.length(), 0);
  assert.equal(game.money, 425); assert.equal(game.heat, 2);
});

test('rigid bodies pause with game time and live physics never enters a save', () => {
  const game = empty(), ride = car(game, 900); ride.elevation = 4; game.vehiclePhysics.sync();
  const body = game.vehiclePhysics.get(ride.id), before = body.position.clone();
  game.update(0); game.update(NaN); assert.deepEqual(body.position, before);
  const save = JSON.stringify(game.exportSave());
  for (const field of ['orientation','elevation','verticalVelocity','angularVelocity','bodies']) assert.equal(save.includes(field), false);
});

test('angled lot roofs, on-foot walls, and tool trajectories share the same rotated footprint', () => {
  const game = empty(), angle = Math.PI / 4, c = Math.cos(angle), s = Math.sin(angle);
  const building = { x: 1320, y: 1375, w: 160, h: 50, height: 3.4, angle };
  game.buildings = [building]; game.vehiclePhysics.sync();
  const roofPoint = { x: 1400 + 55 * c, y: 1400 + 55 * s };
  assert.ok(roofPoint.y > building.y + building.h, 'fixture is outside the unrotated source rectangle');
  assert.ok(Math.abs(game.vehiclePhysics.support(roofPoint.x, roofPoint.y, 5) - building.height) < 1e-10);
  assert.equal(game.vehiclePhysics.support(1340, 1420, 5), 0, 'a source-rectangle corner outside the rotated solid stays clear');

  const free = { x: 1340, y: 1420, elevation: 0 };
  assert.equal(game._moveCircleBuildings(free, 0, 0, PLAYER_RADIUS), false);
  assert.deepEqual(free, { x: 1340, y: 1420, elevation: 0 });
  const person = { ...roofPoint, elevation: 0 };
  assert.equal(game._moveCircleBuildings(person, 0, 0, PLAYER_RADIUS), true);
  const localX = (person.x - 1400) * c + (person.y - 1400) * s;
  const localY = -(person.x - 1400) * s + (person.y - 1400) * c;
  const distance = Math.hypot(Math.max(0, Math.abs(localX) - 80), Math.max(0, Math.abs(localY) - 25));
  assert.ok(distance >= PLAYER_RADIUS, 'standing player is outside the actual angled wall');
  const standingOnRoof = { ...roofPoint, elevation: building.height };
  assert.equal(game._moveCircleBuildings(standingOnRoof, 0, 0, PLAYER_RADIUS), false, 'the roof remains walkable');

  assert.equal(game.vehiclePhysics.hitsSegment({ x: 1350, y: 1450, height: 1 }, { x: 1500, y: 1450, height: 1 }), true, 'the angled facade blocks a tool shot beyond the old rectangle');
  assert.equal(game.vehiclePhysics.hitsSegment({ x: 1350, y: 1450, height: 4 }, { x: 1500, y: 1450, height: 4 }), false, 'shots over the complete roof remain clear');
});

test('an angled facade bounces a chassis along its real surface normal', () => {
  const game = empty(), angle = 0.6, c = Math.cos(angle), s = Math.sin(angle);
  game.buildings = [{ x: 1320, y: 1350, w: 160, h: 100, height: 6, angle }];
  const ride = car(game, 1400 - 165 * c, 1400 - 165 * s);
  ride.angle = angle; ride.speed = 280; ride.vx = 280 * c; ride.vy = 280 * s;
  let normalVelocity = 0, maxHeight = 0;
  stepBodies(game, 0.8, () => {
    normalVelocity = Math.min(normalVelocity, ride.vx * c + ride.vy * s);
    maxHeight = Math.max(maxHeight, ride.elevation);
  });
  assert.ok(normalVelocity < -30, 'impact reverses velocity against the rotated wall');
  assert.ok((ride.x - 1400) * c + (ride.y - 1400) * s < -80, 'the chassis stays on the approach side');
  assert.ok(maxHeight > 0.15, 'the existing playful elastic launch is preserved');
});

test('rotated compound props expose their real offset footprint and elevation', () => {
  const game = empty(); game.staticObjects = [{ kind: 'bench', x: 1400, y: 1400, angle: Math.PI / 2, elevation: 0.2,
    parts: [{ half: [0.8, 0.1, 0.2], offset: [0.3, 0.5, 0] }] }];
  game.vehiclePhysics.sync();
  assert.ok(Math.abs(game.vehiclePhysics.support(1400, 1418, 2) - 0.8) < 1e-10, 'local X offset and long axis rotate into map Y');
  assert.equal(game.vehiclePhysics.support(1418, 1400, 2), 0, 'the old axis-aligned footprint does not block empty space');
});

test('expanded physics bounds allow suburban driving and bounce at the new perimeter', () => {
  const game = empty();
  assert.equal(Game.SIZE, 12000);
  assert.equal(game.vehiclePhysics.size, Game.SIZE);
  const suburban = car(game, 9000, 7500); suburban.speed = suburban.vx = 180;
  stepBodies(game, 0.5);
  assert.ok(suburban.x > 9070, 'previous map boundaries no longer trap cars on the larger terrain');
  const edge = car(game, Game.SIZE - 80, 7500); edge.speed = edge.vx = 280;
  let bounce = false; stepBodies(game, 0.6, () => { bounce ||= edge.vx < -20; });
  assert.ok(bounce, 'the new outer boundary reverses chassis velocity');
  assert.ok(edge.x < Game.SIZE - 20, 'the vehicle remains inside the expanded town');
  assert.equal(game.vehiclePhysics.world.bodies.filter(body => body.kind === 'boundary').length, 4);
});

test('world-size resynchronization preserves live cars while replacing all four perimeter walls', () => {
  const game = empty(), ride = car(game, 3000, 3500); delete game.world.bounds; game.vehiclePhysics.sync();
  const body = game.vehiclePhysics.get(ride.id), oldWalls = game.vehiclePhysics.world.bodies.filter(candidate => candidate.kind === 'boundary');
  const enlarged = Game.SIZE + 600;
  game.world = { ...game.world, size: enlarged }; game.vehiclePhysics.sync();
  assert.equal(game.vehiclePhysics.size, enlarged, 'the active world size takes priority over the Game fallback');
  assert.equal(game.vehiclePhysics.get(ride.id), body, 'resizing fixed bounds preserves dynamic body identity');
  assert.equal(game.vehiclePhysics.world.bodies.filter(candidate => candidate.kind === 'boundary').length, 4);
  for (const wall of oldWalls) assert.equal(game.vehiclePhysics.world.bodies.includes(wall), false);
  assert.ok(game.vehiclePhysics.world.bodies.some(candidate => candidate.kind === 'boundary' && candidate.position.x === (enlarged + 10) / 20), 'east boundary follows the resized world');
});

function sampledTerrain(count, step, sample) {
  const heights = new Float32Array(count * count);
  for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) heights[row * count + col] = sample(col * step / 20, row * step / 20);
  const heightAt = (x, z) => {
    const gx = Math.max(0, Math.min(count - 1, x / step)), gz = Math.max(0, Math.min(count - 1, z / step));
    const col = Math.min(count - 2, Math.floor(gx)), row = Math.min(count - 2, Math.floor(gz)), u = gx - col, v = gz - row;
    const a = heights[row * count + col], b = heights[row * count + col + 1], c = heights[(row + 1) * count + col], d = heights[(row + 1) * count + col + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  };
  const normalAt = (x, z) => {
    const delta = 0.01, dx = (heightAt(x + delta, z) - heightAt(x - delta, z)) * 20 / (delta * 2);
    const dz = (heightAt(x, z + delta) - heightAt(x, z - delta)) * 20 / (delta * 2), length = Math.hypot(dx, 1, dz);
    return { x: -dx / length, y: 1 / length, z: -dz / length };
  };
  return { count, step, size: (count - 1) * step, heights, heightAt, surfaceHeight: heightAt, normalAt, surfaceNormalAt: normalAt };
}

function terrainTown(terrain, roads = []) {
  const town = { world: { size: terrain.size, terrain, roads }, terrain, roads, buildings: [], staticObjects: [], cars: [], police: [] };
  town.vehiclePhysics = new VehicleWorld(town, CAR_TYPES);
  return town;
}

function terrainCar(town, x, y, elevation = town.terrain.surfaceHeight(x, y), kind = 'compact') {
  const ride = { id: 'terrain-car-' + town.cars.length, x, y, angle: 0, kind, elevation, speed: 0, vx: 0, vy: 0, verticalVelocity: 0 };
  town.cars.push(ride); town.vehiclePhysics.sync(); return ride;
}

test('fast cars absorb small rough-ground undulations without pitching into a flip', () => {
  for (const [amplitude, wavelength] of [[0.1, 10], [0.2, 24], [0.4, 6], [0.6, 10]]) {
    // Gentle undulations cover standard and fully upgraded boost. Larger
    // waves at full boost become ramps, where airborne rotation remains free.
    const multipliers = amplitude <= 0.2 ? [1, 1.2, 1.425] : [1];
    for (const kind of ['compact', 'sports', 'van']) for (const reverse of [false, true]) for (const multiplier of multipliers) {
      const terrain = sampledTerrain(129, 31.25, x => 2 + amplitude * Math.sin(2 * Math.PI * x / wavelength));
      const town = terrainTown(terrain), physics = town.vehiclePhysics;
      const ride = terrainCar(town, reverse ? 3200 : 800, 2000, undefined, kind);
      ride.angle = reverse ? Math.PI : 0; physics.reset(ride);
      const body = physics.get(ride.id), baseSpeed = VehicleStats.getModel(ride).maxSpeed, speed = baseSpeed * multiplier;
      body.velocity.set((reverse ? -1 : 1) * speed / 20, 0, 0);
      let distance = 0;
      for (let frame = 0; frame < 300; frame++) {
        const x = ride.x, y = ride.y;
        physics.control(ride, { up: true, boost: multiplier > 1, maxSpeed: speed }); physics.step(1 / 60);
        distance += Math.hypot(ride.x - x, ride.y - y);
        const up = body.quaternion.vmult(new C.Vec3(0, 1, 0));
        assert.ok(up.y > 0.6, `${kind} ${reverse ? 'westbound' : 'eastbound'} at ${multiplier}x speed stays upright over ${amplitude}m undulations (frame ${frame}, up ${up.y})`);
      }
      assert.ok(distance > baseSpeed * (amplitude <= 0.2 ? 3 : 2), `${kind} retains useful driving speed over ${amplitude}m undulations (${distance} units)`);
    }
  }
});

test('ground suspension preserves yaw and leaves airborne and blast rotations free', () => {
  for (const mode of ['ground', 'airborne', 'blast']) {
    const { world, ride } = controlledWorld(mode === 'airborne' ? { elevation: 5 } : {});
    const body = world.get(ride.id);
    body.angularVelocity.set(0, 2.5, 6); body.wakeUp();
    if (mode === 'blast') world.impulse(ride, { x: 0, y: 3, z: 0 });
    world.step(1 / 60);
    assert.ok(body.angularVelocity.y > 2.4, `${mode} retains its yaw spin`);
    if (mode === 'ground') assert.ok(Math.abs(body.angularVelocity.z) <= 1.5, 'terrain contact absorbs excessive pitch');
    else if (mode === 'airborne') assert.ok(body.angularVelocity.z > 5.8, 'airborne tumbling momentum remains free');
    else assert.ok(body.angularVelocity.z > 3, 'blast rotation exceeds the suspension limit despite starting in ground contact');
  }
});

test('cars traverse both real river bridges and their ground approaches in either direction', () => {
  const world = require('../world.js').createWorld();
  for (const ids of [
    ['willow-bottom-road', 'bridge-north-approach', 'bridge-north', 'airport-north-link'],
    ['eastmarket-road', 'bridge-city-approach', 'bridge-city', 'airport-city-link']
  ]) for (const reverse of [false, true]) {
    const path = [];
    for (const [i, id] of ids.entries()) {
      const road = world.network.roadById.get(id), from = i === 0 ? road.length - 180 : 0, to = i === ids.length - 1 ? 180 : road.length;
      for (let s = from; s < to; s += 12) path.push(world.network.pointOnRoad(id, s));
      path.push(world.network.pointOnRoad(id, to));
    }
    if (reverse) path.reverse();
    const town = terrainTown(world.terrain, world.roads), start = path[0], physics = town.vehiclePhysics;
    const ride = terrainCar(town, start.x, start.y);
    ride.angle = Math.atan2(path[1].y - start.y, path[1].x - start.x); physics.reset(ride);
    let next = 1, maxGap = 0, stalledFrames = 0;
    for (let frame = 0; frame < 2400 && next < path.length; frame++) {
      while (next < path.length - 1 && Math.hypot(ride.x - path[next].x, ride.y - path[next].y) < 35) next++;
      const target = path[next];
      physics.control(ride, { targetSpeed: 110, heading: Math.atan2(target.y - ride.y, target.x - ride.x) });
      physics.step(1 / 60);
      maxGap = Math.max(maxGap, Math.abs(ride.elevation - world.terrain.surfaceHeight(ride.x, ride.y)));
      if (frame > 120 && ride.speed < 30) stalledFrames++;
      if (next === path.length - 1 && Math.hypot(ride.x - target.x, ride.y - target.y) < 35) next++;
    }
    const label = ids[2] + (reverse ? ' westbound' : ' eastbound');
    assert.equal(next, path.length, label + ' completes the crossing without getting stuck on a terrain/deck step');
    assert.ok(maxGap < .55, label + ' stays close to the driving surface');
    assert.ok(stalledFrames < 60, label + ' has no sustained collision stop');
    assert.ok(ride.upright, label + ' remains upright');
  }
});

test('Cannon heightfield rows and triangle halves match absolute sampled terrain, including negative heights', () => {
  const terrain = sampledTerrain(3, 200, (x, z) => -4 + 0.6 * x + 0.5 * z - 0.01 * x * z);
  const town = terrainTown(terrain), physics = town.vehiclePhysics;
  assert.ok(physics.floor.shapes[0] instanceof C.Heightfield, 'real terrain replaces the infinite zero plane');
  for (const [x, z, expected] of [[40, 60, -1.3], [160, 140, 3.8], [0, 0, -4], [400, 400, 14]]) {
    assert.ok(Math.abs(physics.support(x, z, 30) - expected) < 1e-9, `ray height at ${x},${z} uses the shared triangle`);
  }
  assert.equal(physics.groundHeight(0, 0), -4, 'sea floor retains its negative elevation');
  assert.equal(physics.support(1000, 1000, 30), terrain.surfaceHeight(1000, 1000), 'out-of-grid query falls back to the shared clamped terrain sampler');
  const floor = physics.floor;
  town.buildings = [{ x: 80, y: 80, w: 40, h: 40, elevation: 2, height: 3 }]; physics.sync();
  assert.equal(physics.floor, floor, 'a static prop/lot refresh preserves the heightfield');
  assert.ok(Math.abs(physics.support(100, 100, 10) - 5) < 1e-10, 'elevated building roof remains an absolute support surface');
});

test('grounded slope driving climbs without artificial launches and reset aligns the chassis with the hill', () => {
  const terrain = sampledTerrain(65, 31.25, (x, z) => 3 + 0.18 * x + 0.06 * z), town = terrainTown(terrain);
  const ride = terrainCar(town, 400, 400), physics = town.vehiclePhysics;
  physics.reset(ride);
  const start = { x: ride.x, height: ride.elevation }, normal = terrain.normalAt(ride.x, ride.y);
  const up = physics.get(ride.id).quaternion.vmult(new C.Vec3(0, 1, 0));
  assert.ok(up.dot(new C.Vec3(normal.x, normal.y, normal.z)) > 0.99999, 'reset rests the bottom plane on the surface normal');
  assert.ok(ride.elevation >= terrain.surfaceHeight(ride.x, ride.y));
  let maxGap = 0, impacts = 0;
  for (let i = 0; i < 120; i++) {
    physics.control(ride, { up: true }); impacts += physics.step(1 / 60).length;
    maxGap = Math.max(maxGap, Math.abs(ride.elevation - terrain.heightAt(ride.x, ride.y)));
  }
  assert.ok(ride.x > start.x + 250 && ride.elevation > start.height + 2, 'driving force follows the hill and makes meaningful uphill progress');
  assert.ok(maxGap < 0.15, 'solid slope contacts keep the chassis near the ground');
  assert.equal(impacts, 0, 'ordinary terrain contacts never trigger bumper damage or cartoon lift');
  assert.equal(ride.grounded, true);
  physics.reset(ride); const parked = { x: ride.x, y: ride.y };
  for (let i = 0; i < 120; i++) physics.step(1 / 60);
  assert.ok(Math.hypot(ride.x - parked.x, ride.y - parked.y) < 1, 'a parked car does not slide away down a hill');
});

test('actual hillside parking bays retain resting physical cars and release them for driving and blasts', () => {
  const game = new Game({ seed: 42 }), physics = game.vehiclePhysics;
  const parked = game.world.vehicleSpawns.filter(spawn => !spawn.traffic).map(spawn => {
    const ride = game.cars.find(car => Math.hypot(car.x - spawn.x, car.y - spawn.y) < 0.1);
    assert.ok(ride, `a real car occupies ${spawn.parkingBayId}`);
    return { spawn, ride, body: physics.get(ride.id), bay: game.world.parkingBays.find(bay => bay.id === spawn.parkingBayId) };
  });
  assert.ok(parked.some(entry => entry.spawn.roadId === 'pine-road'), 'the steep van parking repro is included');
  advance(game, 4);
  for (const { spawn, ride, body, bay } of parked) {
    assert.ok(ride.upright && ride.grounded, `${spawn.roadId} retains a grounded upright car`);
    assert.ok(Math.hypot(ride.x - spawn.x, ride.y - spawn.y) < 1, `${spawn.roadId} holds its parked position`);
    assert.ok(body.mass > 0 && body.type === C.Body.DYNAMIC, 'parking retains a real dynamic collision body');
    const half = body.shapes[0].halfExtents, cosine = Math.cos(bay.angle), sine = Math.sin(bay.angle);
    for (const x of [-half.x, half.x]) for (const y of [-half.y, half.y]) for (const z of [-half.z, half.z]) {
      const offset = body.quaternion.vmult(new C.Vec3(x, y, z));
      const dx = (body.position.x + offset.x) * 20 - (bay.x + bay.w / 2), dz = (body.position.z + offset.z) * 20 - (bay.y + bay.h / 2);
      assert.ok(Math.abs(dx * cosine + dz * sine) <= bay.w / 2 + 0.1, `${spawn.roadId} fits its full chassis length inside the bay`);
      assert.ok(Math.abs(-dx * sine + dz * cosine) <= bay.h / 2 + 0.1, `${spawn.roadId} fits its full chassis width inside the bay`);
    }
    let minGap = Infinity, maxGap = -Infinity;
    for (let ix = 0; ix <= 24; ix++) for (let iz = 0; iz <= 24; iz++) {
      const offset = body.quaternion.vmult(new C.Vec3(-half.x + half.x * ix / 12, -half.y, -half.z + half.z * iz / 12));
      const ground = game.terrain.surfaceHeight((body.position.x + offset.x) * 20, (body.position.z + offset.z) * 20);
      const gap = body.position.y + offset.y - ground;
      minGap = Math.min(minGap, gap); maxGap = Math.max(maxGap, gap);
    }
    assert.ok(minGap >= -0.005 && minGap < 0.03, `${spawn.roadId} rests against actual terrain without penetration or suspension`);
    assert.ok(maxGap < 0.2, `${spawn.roadId} has a usable parking footprint rather than balancing on a terrain peak`);
  }
  const { ride, body, spawn } = parked.find(entry => entry.spawn.roadId === 'pine-road');
  game.player.vehicleId = ride.id;
  advance(game, 0.5, { up: true });
  assert.equal(physics.get(ride.id), body, 'driving wakes the same body instead of replacing a parked placeholder');
  assert.notEqual(body.sleepState, C.Body.SLEEPING);
  assert.ok(Math.hypot(ride.x - spawn.x, ride.y - spawn.y) > 30 && ride.speed > 30, 'throttle releases the parking brake and drives away');
  assert.ok(ride.upright && ride.grounded, 'the released car retains real slope contact');
  game.player.vehicleId = null; ride.x = spawn.x; ride.y = spawn.y; ride.angle = spawn.angle; physics.reset(ride);
  const restingHeight = ride.elevation;
  physics.impulse(ride, { x: 2, y: 6, z: 0 });
  advance(game, 0.2);
  assert.equal(physics.get(ride.id), body);
  assert.ok(ride.elevation > restingHeight + 0.4 && ride.verticalVelocity > 1, 'a blast wakes and launches the resting dynamic car');
  assert.equal(ride.grounded, false, 'launched cars lose ground support normally');
});

test('sloped bridge decks support cars above the sea floor without phantom under-bridge grounding', () => {
  const terrain = sampledTerrain(33, 50, () => -4), slope = 2 / 44;
  const road = { id: 'bridge-test', bridge: true, width: 100, points: [{ x: 320, y: 800, elevation: 2 }, { x: 760, y: 800, elevation: 3 }, { x: 1200, y: 800, elevation: 4 }] };
  terrain.surfaceHeight = (x, z) => x >= 320 && x <= 1200 && Math.abs(z - 800) <= 82 ? 2 + (x - 320) / 440 : -4;
  terrain.surfaceNormalAt = (x, z) => terrain.surfaceHeight(x, z) > -4 ? { x: -slope / Math.hypot(slope, 1), y: 1 / Math.hypot(slope, 1), z: 0 } : { x: 0, y: 1, z: 0 };
  const town = terrainTown(terrain, [road]), physics = town.vehiclePhysics;
  assert.equal(physics.bridgeBodies.length, 2);
  for (const x of [400, 600, 900, 1100]) assert.ok(Math.abs(physics.support(x, 800, 10) - terrain.surfaceHeight(x, 800)) < 1e-10, 'deck top follows the shared sloped profile');
  assert.ok(Math.abs(physics.support(760, 800, 1) + 4) < 1e-10, 'a point below the deck sees the actual sea floor');
  const under = terrainCar(town, 1000, 800, 0), body = physics.get(under.id);
  assert.equal(physics._nearGround(body, 0.65), false, 'the higher walking deck does not ground a chassis underneath it');
  town.cars = []; physics.sync();
  const ride = terrainCar(town, 650, 800, 6); let impacts = 0;
  for (let i = 0; i < 120; i++) impacts += physics.step(1 / 60).length;
  assert.ok(Math.abs(ride.elevation - terrain.surfaceHeight(ride.x, ride.y)) < 0.08);
  assert.equal(ride.grounded, true); assert.equal(impacts, 0, 'landing on a road deck uses ordinary ground contact');
  const deck = physics.bridgeBodies[0], floor = physics.floor;
  town.staticObjects = [{ kind: 'lamp', x: 120, y: 120, elevation: -4, parts: [{ half: [0.1, 1, 0.1], offset: [0, 1, 0] }] }]; physics.sync();
  assert.equal(physics.floor, floor); assert.ok(physics.world.bodies.includes(deck), 'ordinary street-object sync leaves terrain and bridge bodies intact');
});

test('terrain replacement rebuilds the sampled floor without duplicating live cars or perimeter walls', () => {
  const terrain = sampledTerrain(17, 100, () => 5), town = terrainTown(terrain), physics = town.vehiclePhysics;
  const ride = terrainCar(town, 800, 800), body = physics.get(ride.id), oldFloor = physics.floor;
  town.terrain = town.world.terrain = sampledTerrain(17, 100, () => 7); physics.sync();
  assert.notEqual(physics.floor, oldFloor); assert.equal(physics.world.bodies.includes(oldFloor), false);
  assert.equal(physics.get(ride.id), body); assert.equal(physics.world.bodies.filter(candidate => candidate.kind === 'boundary').length, 4);
  assert.ok(Math.abs(physics.support(400, 400, 15) - 7) < 1e-10);
  const east = physics.world.bodies.find(candidate => candidate.kind === 'boundary' && candidate.position.x > 80);
  assert.ok(east.shapes[0].halfExtents.y + east.shapeOffsets[0].y >= 52, 'high terrain and airborne cars stay inside tall perimeter walls');
});

test('a hillside building foundation stops low chassis impacts while preserving the elevated rotated roof', () => {
  const town = terrainTown(sampledTerrain(33, 100, () => 4)), physics = town.vehiclePhysics, angle = Math.PI / 6;
  const building = { x: 1150, y: 1100, w: 100, h: 200, angle, elevation: 8, foundationBottom: 3.88, height: 5 };
  town.buildings = [building]; physics.sync();
  const point = localX => ({ x: 1200 + localX * Math.cos(angle), y: 1200 + localX * Math.sin(angle) });
  const start = point(-170), target = point(0);
  const hit = physics.firstHit({ x: start.x, y: start.y, height: 4.6 }, { x: target.x, y: target.y, height: 4.6 });
  assert.equal(hit?.body.source, building, 'the former empty gap below the wall is a solid foundation');
  assert.ok(Math.abs(physics.support(1200, 1200, 20) - 13) < 1e-10, 'foundation depth never raises the physical roof');
  const ride = terrainCar(town, start.x, start.y);
  ride.angle = angle; ride.speed = 280; ride.vx = Math.cos(angle) * 280; ride.vy = Math.sin(angle) * 280; physics.sync();
  let reversed = false;
  for (let i = 0; i < 48; i++) {
    physics.step(1 / 60);
    reversed ||= ride.vx * Math.cos(angle) + ride.vy * Math.sin(angle) < -30;
  }
  assert.ok(reversed, 'a car below the first-floor base bounces off the rotated plinth');
  const body = physics.world.bodies.find(candidate => candidate.source === building);
  const bottom = body.position.y + body.shapeOffsets[0].y - body.shapes[0].halfExtents.y;
  assert.ok(Math.abs(bottom - building.foundationBottom) < 1e-10);
});

test('a piercing trajectory can ignore struck props while still hitting the next solid terrain-world collider', () => {
  const town = terrainTown(sampledTerrain(33, 100, () => 5)), physics = town.vehiclePhysics;
  const first = { kind: 'tree', x: 650, y: 800, elevation: 5, parts: [{ half: [0.3, 1, 0.3], offset: [0, 1, 0] }] };
  const second = { kind: 'lamp', x: 850, y: 800, elevation: 5, parts: [{ half: [0.1, 1, 0.1], offset: [0, 1, 0] }] };
  const building = { x: 1050, y: 750, w: 100, h: 100, elevation: 7, foundationBottom: 4.88, height: 4 };
  town.staticObjects = [first, second]; town.buildings = [building]; physics.sync();
  const from = { x: 500, y: 800, height: 6 }, to = { x: 1200, y: 800, height: 6 };
  assert.equal(physics.firstHit(from, to).source, first);
  assert.equal(physics.firstHit(from, to, undefined, new Set([first])).source, second, 'ignoring a struck prop does not skip unrelated fixed colliders');
  assert.equal(physics.firstHit(from, to, undefined, new Set([first, second])).source, building, 'the solid foundation remains an obstruction below the raised floor');
  first.destroyed = true; town._environmentVersion = 1; physics.sync();
  assert.equal(physics.firstHit(from, to).source, second, 'destroyed prop removal still updates the physical world');
});

test('component damage reduces manual acceleration and caps boosted and AI driving at the damaged model speed', () => {
  const healthy = controlledWorld(), damaged = controlledWorld({ health: 45, engineHealth: 45, handlingHealth: 70 });
  driveWorld(healthy, 0.4, { up: true }); driveWorld(damaged, 0.4, { up: true });
  assert.ok(damaged.ride.speed < healthy.ride.speed * 0.6, 'a damaged engine noticeably loses acceleration');
  for (const command of [{ up: true, boost: true, maxSpeed: 450 }, { targetSpeed: 900, heading: 0 }]) {
    const good = controlledWorld(), bad = controlledWorld({ health: 45, engineHealth: 45 });
    driveWorld(good, 4, command); driveWorld(bad, 4, command);
    const base = VehicleStats.getModel(bad.ride), effective = VehicleStats.performance(bad.ride);
    const cap = (command.maxSpeed || base.maxSpeed) * effective.maxSpeed / base.maxSpeed;
    assert.ok(bad.ride.speed <= cap + 2, 'boost and AI respect the degraded top speed');
    assert.ok(good.ride.speed > bad.ride.speed * 1.4, 'healthy and damaged models have distinct usable speed');
  }
});

test('model choice affects the physical driving limits', () => {
  const standard = controlledWorld(), streetbug = controlledWorld({ modelId: 'pogo-streetbug' });
  driveWorld(standard, 3, { up: true }); driveWorld(streetbug, 3, { up: true });
  assert.ok(standard.ride.speed > streetbug.ride.speed + 15);
  assert.ok(streetbug.ride.speed <= VehicleStats.getModel(streetbug.ride).maxSpeed + 5, 'the arcade speed cap permits only a small solver overshoot');
});

test('stalled or wrecked vehicles cannot drive in either direction but retain inertia and braking', () => {
  for (const damage of [{ engineHealth: 0 }, { health: 0 }, { exploded: true }]) {
    for (const command of [{ up: true }, { down: true }, { targetSpeed: 200, heading: 0 }, { targetSpeed: -100, heading: 0 }]) {
      const fixture = controlledWorld(damage); driveWorld(fixture, 0.6, command);
      assert.ok(Math.abs(fixture.ride.speed) < 0.01, 'unpowered cars stay stationary under throttle');
    }
    const coast = controlledWorld({ ...damage, speed: 180, vx: 180 }), braking = controlledWorld({ ...damage, speed: 180, vx: 180 });
    driveWorld(coast, 0.25, { up: true }); driveWorld(braking, 0.25, { brake: true });
    assert.ok(coast.ride.speed > 170, 'engine failure does not erase existing momentum');
    assert.ok(braking.ride.speed < coast.ride.speed * 0.5, 'brakes still work without an engine');
  }
});

test('steering damage weakens chassis turning and tyre grip without removing control', () => {
  const healthy = controlledWorld({ speed: 180, vx: 180, vy: 80 }), damaged = controlledWorld({ speed: 180, vx: 180, vy: 80, handlingHealth: 15 });
  driveWorld(healthy, 0.15, { up: true, steer: 1 }); driveWorld(damaged, 0.15, { up: true, steer: 1 });
  assert.ok(Math.abs(damaged.ride.angle) > 0.01);
  assert.ok(Math.abs(damaged.ride.angle) < Math.abs(healthy.ride.angle) * 0.7, 'the damaged chassis responds more slowly');
  const goodGrip = controlledWorld({ speed: 180, vx: 180, vy: 80 }), badGrip = controlledWorld({ speed: 180, vx: 180, vy: 80, handlingHealth: 15 });
  driveWorld(goodGrip, 0.15, { up: true }); driveWorld(badGrip, 0.15, { up: true });
  assert.ok(badGrip.ride.vy > goodGrip.ride.vy * 1.5, 'damaged tyres retain more lateral slide');
});

test('blast impulses update real body velocity in metres per second and survive resynchronization', () => {
  const fixture = controlledWorld(), { world, ride } = fixture;
  const body = world.get(ride.id), initial = body.velocity.clone();
  world.impulse(ride, { x: 4, y: 3, z: -2 });
  assert.equal(body.velocity.x, initial.x + 4); assert.equal(body.velocity.y, initial.y + 3); assert.equal(body.velocity.z, initial.z - 2);
  assert.equal(ride.vx, 80); assert.equal(ride.vy, -40); assert.equal(ride.verticalVelocity, 3);
  world.sync();
  assert.equal(body.velocity.x, 4); assert.equal(body.velocity.y, 3); assert.equal(body.velocity.z, -2);
  world.step(1 / 60);
  assert.ok(ride.x > 1000); assert.ok(ride.y < 1000); assert.ok(ride.elevation > 0);
  const heavy = controlledWorld({ kind: 'van', modelId: 'tumble-hauler' });
  heavy.world.impulse(heavy.ride, { x: 4, y: 3, z: -2 });
  assert.equal(heavy.world.get(heavy.ride.id).velocity.x, 4, 'mass-scaled impulses deliver the supplied velocity to heavier models');
});

test('blast impulses respect velocity edits made by exiting a vehicle and preserve pending position edits', () => {
  const fixture = controlledWorld({ speed: 180, vx: 180 }), { world, ride } = fixture;
  driveWorld(fixture, 0.2, { up: true });
  ride.x = 1200; ride.vx = 0; ride.vy = 0; ride.speed = 0; ride.verticalVelocity = 0;
  world.impulse(ride, { x: -3, y: 2, z: 1 });
  const body = world.get(ride.id);
  assert.equal(body.position.x, 60); assert.equal(body.velocity.x, -3); assert.equal(body.velocity.z, 1); assert.equal(body.velocity.y, 2);
  world.sync();
  assert.equal(body.position.x, 60); assert.equal(body.velocity.x, -3); assert.equal(body.velocity.z, 1); assert.equal(body.velocity.y, 2);
});
