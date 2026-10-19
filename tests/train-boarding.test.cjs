'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../core.js');
const { PLAYER_RADIUS } = require('../physics.js');
const Trains = require('../trains.js');

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function fixture(front = 8500, speed = 120, serviceIndex = 0) {
  const game = new Game({ seed: 42 });
  // Preserve the real timetable, consist geometry and curved routes, while
  // isolating boarding from ambient traffic and the landscape's obstructions.
  const terrain = { minY: game.world.bounds.minY, heightAt: () => 0, surfaceHeight: () => 0,
    normalAt: () => ({ x: 0, y: 1, z: 0 }), surfaceNormalAt: () => ({ x: 0, y: 1, z: 0 }), isWater: () => false };
  game.world = { ...game.world, terrain };
  game.terrain = terrain;
  game.cars = []; game.police = []; game.peds = []; game.buildings = []; game.staticObjects = [];
  game.aircraft.length = 0;
  game._updatePolice = () => {};
  game.aviation.step = () => {};
  game.tankTraffic.step = () => {};
  game.militaryTransport.step = () => {};
  game.soldierTraffic.step = () => {};
  game.aliens.step = () => {};
  game.graceTimer = 0;
  const system = game.railTraffic, service = system.services[serviceIndex];
  for (const other of system.services) other.next = Infinity;
  service.due = 0;
  assert.equal(system._request(service, 'inbound'), true);
  service.front = front; service.speed = speed;
  system._pose(service, 1 / 60);
  game.vehiclePhysics.sync();
  return { game, system, service, car: service.cars[0] };
}
function place(game, car, along = 0, across = car.railModel.width / 2 + PLAYER_RADIUS + 1) {
  const c = Math.cos(car.angle), s = Math.sin(car.angle);
  Object.assign(game.player, { x: car.x + c * along - s * across, y: car.y + s * along + c * across,
    elevation: 0, verticalVelocity: 0, grounded: true, angle: car.angle, vehicleId: null });
}
function board(game, car, along, across) {
  place(game, car, along, across);
  assert.equal(game.interact(), true, 'E boards the nearby train');
  assert.ok(game.ridingTrain);
  assert.equal(game.player.trainRide.carId, car.id);
}
function assertAttached(game, system) {
  const ride = game.player.trainRide, car = system.cars.find(item => item.id === ride.carId);
  const c = Math.cos(car.angle), s = Math.sin(car.angle), dx = game.player.x - car.x, dy = game.player.y - car.y;
  assert.ok(Math.abs(dx * c + dy * s - ride.along) < 1e-6, 'rider keeps their position along this carriage');
  assert.ok(Math.abs(-dx * s + dy * c - ride.across) < 1e-6, 'rider keeps their side of this carriage');
  assert.equal(game.player.vehicleId, null, 'the train remains outside the driven vehicle system');
  assert.equal(game.current, game.player);
  assert.equal(game.ragdolls.get(game.player.id), undefined);
}
function advance(game, seconds, input = {}) {
  for (let tick = 0; tick < Math.ceil(seconds * 60); tick++) game.update(1 / 60, input);
}
function baseline(f) {
  const system = new Trains.TrainSystem({ world: f.game.world, cars: [], police: [], peds: [], aircraft: [] });
  for (const service of system.services) service.next = Infinity;
  const service = system.services[0];
  service.due = 0;
  assert.equal(system._request(service, f.service.leg), true);
  service.front = f.service.front; service.speed = f.service.speed;
  system._pose(service, 1 / 60);
  for (const gate of system.gates) {
    const original = f.system.gates.find(item => item.id === gate.id);
    Object.assign(gate, { state: original.state, progress: original.progress, timer: original.timer });
  }
  return { system, service };
}

test('E catches either side of a moving train without stealing or stopping it', () => {
  for (const side of [-1, 1]) {
    const { game, system, service, car } = fixture();
    const speed = service.speed;
    board(game, car, 0, side * (car.railModel.width / 2 + PLAYER_RADIUS + 1));
    assertAttached(game, system);
    assert.equal(service.speed, speed);
    assert.equal(car.speed, speed);
    assert.equal(game.heat, 0);
    assert.equal(game.cars.includes(car), false);
    assert.equal(car.borrowed, undefined);
  }
});

test('the exposed trailing end boards at speed, while the leading nose and coupler gap do not', () => {
  const { game, system, service, car } = fixture();
  const tail = service.cars.at(-1);
  place(game, car, car.railModel.length / 2 + PLAYER_RADIUS + 1, 0);
  assert.equal(system.boardingTarget(game.player), null, 'the leading nose offers no foothold');
  const gap = { x: (car.x + tail.x) / 2, y: (car.y + tail.y) / 2, elevation: 0, grounded: true };
  assert.equal(system.boardingTarget(gap), null, 'the coupling between carriages offers no foothold');
  board(game, tail, -tail.railModel.length / 2 - PLAYER_RADIUS - 1, 0);
  assertAttached(game, system);
  assert.ok(game.player.trainRide.along < -tail.railModel.length / 2);
});

test('boarding rejects hidden trains, distant players, and players above the carriage', () => {
  const { game, system, car } = fixture();
  place(game, car);
  const point = { ...game.player };
  car.visible = car.active = false;
  assert.equal(system.boardingTarget(point), null);
  car.visible = car.active = true;
  assert.equal(system.boardingTarget({ ...point, x: point.x + 1000 }), null);
  assert.equal(system.boardingTarget({ ...point, elevation: car.elevation + car.railModel.height + 1 }), null);
  game.player.grounded = false; game.player.verticalVelocity = 4;
  assert.equal(game.interact(), false, 'an airborne player cannot snap onto a train');
  assert.equal(Boolean(game.player.trainRide), false);
});

test('freight cabs and container wagons support side boarding on both freight services', () => {
  for (const serviceIndex of [2, 3]) {
    const { game, system, service } = fixture(8500, 120, serviceIndex);
    for (const car of service.cars) {
      board(game, car);
      assertAttached(game, system);
      assert.equal(game.interact(), true);
    }
    const tail = service.cars.at(-1);
    board(game, tail, -tail.railModel.length / 2 - PLAYER_RADIUS - 1, 0);
    assertAttached(game, system);
  }
});

test('outbound boarding finds the reversed consist rear and rejects its leading end', () => {
  const { game, system, service } = fixture();
  assert.equal(system._request(service, 'outbound'), true);
  system._pose(service, 1 / 60);
  const rear = service.cars[0], lead = service.cars.at(-1);
  place(game, lead, -lead.railModel.length / 2 - PLAYER_RADIUS - 1, 0);
  assert.equal(system.boardingTarget(game.player), null);
  board(game, rear, rear.railModel.length / 2 + PLAYER_RADIUS + 1, 0);
  assertAttached(game, system);
  assert.ok(game.player.trainRide.along > rear.railModel.length / 2);
});

test('a rider follows real curved track despite movement input and stays safe from their train', () => {
  const f = fixture(8800, 140), { game, system, service, car } = f, control = baseline(f);
  board(game, car);
  const start = { x: game.player.x, y: game.player.y }, initialAngle = car.angle;
  for (let tick = 0; tick < 240; tick++) {
    control.system.step(1 / 60);
    game.update(1 / 60, { up: true, left: true, boost: true });
    assert.ok(game.ridingTrain);
    assertAttached(game, system);
    assert.ok(Math.abs(service.speed - control.service.speed) < 1e-9, 'movement keys and rider contacts do not change scheduled speed');
    assert.ok(Math.abs(service.front - control.service.front) < 1e-9, 'the occupied train follows the same schedule as an empty one');
  }
  assert.ok(distance(start, game.player) > 300);
  assert.ok(Math.abs(Math.sin(car.angle - initialAngle)) > .1, 'the simulation actually traverses a curve');
});

test('station reversal keeps the same carriage and side beneath the rider', () => {
  const { game, system, service, car } = fixture();
  service.front = service.route.length; service.speed = 0;
  system._pose(service, 1 / 60);
  service.state = 'dwell'; service.until = system.time + .05;
  board(game, car);
  const ride = { ...game.player.trainRide }, before = { x: game.player.x, y: game.player.y };
  advance(game, .25);
  assert.equal(service.leg, 'outbound');
  assert.equal(game.player.trainRide.carId, ride.carId);
  assert.equal(game.player.trainRide.across, ride.across);
  assertAttached(game, system);
  assert.ok(distance(before, game.player) < 2, 'reversal does not teleport the rider to another carriage');
});

test('an attached rider neither blocks their own crossing nor becomes a standing collision victim', () => {
  const f = fixture(), { game, system, service, car } = f;
  const crossing = service.route.crossings.find(item => item.id === 'rail-crossing-4');
  const gate = system.gates.find(item => item.id === crossing.id);
  service.front = Trains.project(service.route, gate) + car.railModel.length / 2;
  system._pose(service, 1 / 60);
  board(game, car);
  assert.equal(system._occupied(gate), false, 'a rider is carried by the train already occupying the crossing');
  assert.equal(game._standingPeople().includes(game.player), false);
  gate.state = 'closed'; gate.progress = 1;
  const control = baseline(f);
  for (let tick = 0; tick < 60; tick++) {
    control.system.step(1 / 60);
    game.update(1 / 60);
    assert.ok(Math.abs(service.speed - control.service.speed) < 1e-9, 'the rider does not slow the train at a crossing');
    assert.ok(Math.abs(service.front - control.service.front) < 1e-9);
  }
  assert.ok(game.ridingTrain);
  assertAttached(game, system);
});

test('E dismounts a moving train into clear space without changing the train velocity', () => {
  const { game, service, car } = fixture();
  board(game, car);
  const speed = service.speed, velocity = { vx: car.vx, vy: car.vy };
  assert.equal(game.interact(), true);
  assert.equal(Boolean(game.player.trainRide), false);
  assert.equal(Boolean(game.ridingTrain), false);
  assert.equal(game.player.vehicleId, null);
  assert.equal(service.speed, speed);
  assert.equal(car.speed, speed);
  assert.equal(car.vx, velocity.vx); assert.equal(car.vy, velocity.vy);
  assert.equal(game._personFree(game.player.x, game.player.y, PLAYER_RADIUS), true);
  assert.equal(game.player.grounded, true);
});

test('a blocked dismount keeps the player attached until clear space is available', () => {
  const { game, car } = fixture();
  board(game, car);
  game.buildings = [{ x: car.x - 500, y: car.y - 500, w: 1000, h: 1000, elevation: 0, height: 10, angle: 0 }];
  assert.equal(game.interact(), false);
  assert.ok(game.ridingTrain);
  game.buildings = [];
  assert.equal(game.interact(), true);
  assert.equal(Boolean(game.player.trainRide), false);
});

test('jump, flop and toys cannot interrupt a train attachment or damage the carriage', () => {
  const { game, system, car } = fixture();
  board(game, car);
  const projectiles = game.projectiles.length;
  assert.equal(game.jump(), false);
  assert.equal(game.flop(), false);
  assert.equal(game.action(), false);
  assert.equal(game.projectiles.length, projectiles);
  game.update(1 / 60, { jump: true, down: true, right: true });
  assertAttached(game, system);
});

test('recover and arrest clear an attachment without recovering or stopping the scheduled train', () => {
  for (const action of ['recover', '_caught']) {
    const { game, service, car } = fixture();
    board(game, car);
    const before = { x: car.x, y: car.y, speed: service.speed };
    game[action]();
    assert.equal(Boolean(game.player.trainRide), false, action + ' clears the ride');
    assert.equal(Boolean(game.ridingTrain), false);
    assert.equal(game.player.vehicleId, null);
    assert.equal(car.x, before.x); assert.equal(car.y, before.y);
    assert.equal(service.speed, before.speed);
    assert.equal(car.speed, before.speed);
    assert.equal(game._personFree(game.player.x, game.player.y, PLAYER_RADIUS), true);
  }
});

test('a train leaving the map releases its rider onto a valid position', () => {
  const { game, system, service } = fixture();
  service.state = 'dwell'; service.due = system.time;
  assert.equal(system._request(service, 'outbound'), true);
  service.front = service.route.length - 1300; service.speed = 120;
  system._pose(service, 1 / 60);
  const car = service.cars[0];
  board(game, car);
  service.front = service.route.length - .01; service.speed = 1;
  system._pose(service, 1 / 60);
  game.update(1 / 60);
  assert.equal(Boolean(game.player.trainRide), false);
  assert.equal(Boolean(game.ridingTrain), false);
  const bounds = game._worldBounds();
  assert.ok(game.player.x >= bounds.minX + PLAYER_RADIUS && game.player.x <= bounds.maxX - PLAYER_RADIUS);
  assert.ok(game.player.y >= bounds.minY + PLAYER_RADIUS && game.player.y <= bounds.maxY - PLAYER_RADIUS);
  assert.equal(game._personFree(game.player.x, game.player.y, PLAYER_RADIUS), true);
  assert.equal(game.player.grounded, true);
});
