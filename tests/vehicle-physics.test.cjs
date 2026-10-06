'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../core.js');
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
  game.player.x = 900; game.player.y = 900; game.graceTimer = 0;
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

test('jumping cannot pass through a carwash beam or an airborne underbody', () => {
  for (const underbody of [false, true]) {
    const game = empty();
    if (underbody) { const ride = car(game, 900); ride.elevation = 2.4; game.vehiclePhysics.sync(); }
    else { game.staticObjects = [{ kind: 'wash', x: 900, y: 900, parts: [{ half: [2.4,0.175,0.325], offset: [0,2.55,0] }] }]; game.vehiclePhysics.sync(); }
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
  assert.equal(Game.SIZE, 5600);
  assert.equal(game.vehiclePhysics.size, Game.SIZE);
  const suburban = car(game, 4250, 4500); suburban.speed = suburban.vx = 180;
  stepBodies(game, 0.5);
  assert.ok(suburban.x > 4320, 'the old 2160 perimeter no longer traps suburban cars');
  const edge = car(game, 5520, 4500); edge.speed = edge.vx = 280;
  let bounce = false; stepBodies(game, 0.6, () => { bounce ||= edge.vx < -20; });
  assert.ok(bounce, 'the new outer boundary reverses chassis velocity');
  assert.ok(edge.x < Game.SIZE - 20, 'the vehicle remains inside the expanded town');
  assert.equal(game.vehiclePhysics.world.bodies.filter(body => body.kind === 'boundary').length, 4);
});

test('world-size resynchronization preserves live cars while replacing all four perimeter walls', () => {
  const game = empty(), ride = car(game, 3000, 3500); game.vehiclePhysics.sync();
  const body = game.vehiclePhysics.get(ride.id), oldWalls = game.vehiclePhysics.world.bodies.filter(candidate => candidate.kind === 'boundary');
  game.world = { ...game.world, size: 6200 }; game.vehiclePhysics.sync();
  assert.equal(game.vehiclePhysics.size, 6200, 'the active world size takes priority over the Game fallback');
  assert.equal(game.vehiclePhysics.get(ride.id), body, 'resizing fixed bounds preserves dynamic body identity');
  assert.equal(game.vehiclePhysics.world.bodies.filter(candidate => candidate.kind === 'boundary').length, 4);
  for (const wall of oldWalls) assert.equal(game.vehiclePhysics.world.bodies.includes(wall), false);
  assert.ok(game.vehiclePhysics.world.bodies.some(candidate => candidate.kind === 'boundary' && candidate.position.x === 6210 / 20), 'east boundary follows the resized world');
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
