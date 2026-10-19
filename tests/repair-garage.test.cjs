'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GARAGE_SERVICE_TIMING } = require('../core.js');
const World = require('../world.js');
const Railway = require('../railway.js');
const { makeFlatGame } = require('./helpers/flat-game.cjs');

function advance(game, seconds, input = {}) {
  for (let remaining = seconds; remaining > .000001; remaining -= .1) game.update(Math.min(.1, remaining), input);
}

function transitionFixture() {
  const game = makeFlatGame(), service = game.services.find(value => value.id === 'repair'), car = game.cars[0];
  Object.assign(car, { x: service.x, y: service.y, angle: service.angle + Math.PI / 2,
    elevation: service.elevation, speed: 0, vx: 0, vy: 0, health: 40, engineHealth: 35, handlingHealth: 25 });
  game.player.vehicleId = car.id;
  Object.assign(game.player, { x: car.x, y: car.y, elevation: car.elevation });
  game.money = 200; game.heat = 2; game.vehiclePhysics.reset(car); game.vehiclePhysics.sync(); game.drainEvents();
  return { game, service, car };
}

function fixture(kind = 'compact') {
  const game = new Game({ seed: 42 }), service = game.services.find(value => value.id === 'repair');
  const garage = game.staticObjects.find(object => object.serviceId === 'repair');
  game.cars = []; game.police = []; game.peds = [];
  const car = game._addCar(service.x, service.y, service.angle + Math.PI / 2, kind, '#ffd15b');
  game.player.vehicleId = car.id; game.money = 200;
  const point = (x, y) => ({ x: service.x + Math.cos(service.angle) * x - Math.sin(service.angle) * y,
    y: service.y + Math.sin(service.angle) * x + Math.cos(service.angle) * y });
  return { game, service, garage, car, point };
}

test('the solid workshop and its full-width access stay clear of roads, rails, water and buildings', () => {
  const { game, garage, point } = fixture();
  assert.equal(garage.destructible, false);
  assert.equal(game._damageProp(garage, 10000), false);
  for (const road of game.roads) for (let i = 1; i < road.points.length; i++) {
    assert.ok(World.segmentBoxDistance(road.points[i - 1], road.points[i], garage.lot) >= road.width / 2 + game.world.sidewalkWidth);
  }
  for (const box of [garage.lot, garage.driveway]) {
    assert.equal(Railway.intersectsBox(game.world.railway, box, 20), false);
    for (const building of game.buildings) assert.equal(World.boxesOverlap(box, building), false);
    for (const corner of World.footprintCorners(box)) assert.equal(game._dry(corner), true);
  }
  for (let y = -210; y <= 55; y += 10) for (const x of [-25, 0, 25]) {
    const p = point(x, y);
    assert.ok(game._vehicleFree({ ...p, kind: 'van', angle: garage.angle + Math.PI / 2, elevation: game._ground(p) }));
    assert.ok(Math.abs(game._ground(p) - garage.elevation) < .01, 'the entrance and bay have continuous level physical support');
  }
  for (const p of [point(-96, 0), point(96, 0), point(0, 116)]) {
    assert.equal(game._vehicleFree({ ...p, kind: 'compact', angle: 0, elevation: garage.elevation }), false, 'walls stay solid');
  }
  assert.ok(game.vehiclePhysics.support(garage.x, garage.y, garage.elevation + 7) >= garage.elevation + 5.3 - .001, 'the roof is solid');
});

test('compact, sports car and van physically drive into the workshop and reverse back out', () => {
  for (const kind of ['compact', 'sports', 'van']) {
    const { game, service, car, point } = fixture(kind);
    Object.assign(car, point(0, -210), { elevation: service.elevation });
    game.vehiclePhysics.sync();
    const heading = car.angle;
    const drive = (seconds, targetSpeed) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        game.vehiclePhysics.control(car, { targetSpeed, heading }); game.vehiclePhysics.step(1 / 60);
      }
    };
    drive(3, 70); drive(.8, 0);
    assert.equal(game.repairAvailable, true, kind + ' stops fully inside the bay');
    assert.ok(Math.abs(car.elevation - service.elevation) < .1);
    drive(3.8, -70); drive(.8, 0);
    const localDepth = -(car.x - service.x) * Math.sin(service.angle) + (car.y - service.y) * Math.cos(service.angle);
    assert.ok(localDepth < -180, kind + ' can reverse out through the open doorway');
    assert.equal(game.insideRepairBay(), false);
  }
});

test('service requires a stopped, grounded ride fully inside the bay and never spends cash on failed requests', () => {
  const { game, service, car, point } = fixture(); car.health = 40; car.engineHealth = 35; car.handlingHealth = 25; game.heat = 2;
  for (const state of [
    { ...point(0, -120), speed: 0, elevation: service.elevation },
    { ...point(110, 0), speed: 0, elevation: service.elevation },
    { ...point(0, 0), speed: 25, elevation: service.elevation },
    { ...point(0, 0), speed: 0, elevation: service.elevation + 6 }
  ]) {
    Object.assign(car, state); assert.equal(game._useService(service), false);
    assert.equal(game.money, 200); assert.equal(car.health, 40); assert.equal(game.heat, 2);
    assert.equal(game.garageService, null); assert.equal(game.garageTransition, null);
  }
  Object.assign(car, point(0, 0), { elevation: service.elevation, speed: 0 });
  game.player.vehicleId = null; assert.equal(game._useService(service), false); assert.equal(game.money, 200);
  game.player.vehicleId = car.id; game.money = 74;
  assert.equal(game._useService(service), false); assert.equal(game.money, 74);
  assert.equal(game.garageService, null); assert.equal(game.garageTransition, null);
  game.money = 200; assert.equal(game.interact(), true);
  assert.equal(game.money, 125); assert.equal(game.heat, 2); assert.equal(car.health, 40);
  assert.equal(game.interact(), false); assert.equal(game.player.vehicleId, car.id);
  advance(game, GARAGE_SERVICE_TIMING.duration + .01);
  assert.equal(game.heat, 0);
  assert.equal(car.health, game.maxHealth); assert.equal(car.engineHealth, 100); assert.equal(car.handlingHealth, 100);
  assert.equal(game.player.vehicleId, car.id);
  assert.equal(game._useService(service), false); assert.equal(game.money, 125);
  assert.equal(game.garageService, null); assert.equal(game.garageTransition, null);
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null);
});

test('repair cinematic closes the shutter, repairs under black, then fades in and opens before returning control', () => {
  const { game, service, car } = transitionFixture();
  assert.deepEqual(GARAGE_SERVICE_TIMING, { close: .9, blackAt: 1.5, revealAt: 2.15, openAt: 2.75, duration: 3.65 });
  assert.equal(game.garageTransition, null); assert.equal(game.interact(), true);
  assert.equal(game.money, 125); assert.equal(game.garageService.vehicleId, car.id);
  assert.equal(game.garageService.serviceId, service.id); assert.equal(game.garageService.serviced, false);
  assert.equal(game.garageTransition.phase, 'closing'); assert.equal(game.garageTransition.door, 0);
  assert.equal(game.garageTransition.opacity, 0);
  advance(game, .45);
  assert.equal(game.garageTransition.phase, 'closing'); assert.ok(game.garageTransition.door > 0 && game.garageTransition.door < 1);
  assert.equal(game.garageTransition.opacity, 0); assert.equal(car.health, 40);
  advance(game, .75);
  assert.equal(game.garageTransition.phase, 'fade-out'); assert.equal(game.garageTransition.door, 1);
  assert.ok(game.garageTransition.opacity > 0 && game.garageTransition.opacity < 1);
  assert.equal(car.health, 40); assert.equal(game.heat, 2);
  advance(game, .29); assert.equal(car.health, 40); assert.equal(game.garageService.serviced, false);
  advance(game, .02);
  assert.equal(game.garageTransition.phase, 'repairing'); assert.equal(game.garageTransition.opacity, 1);
  assert.equal(game.garageTransition.door, 1); assert.equal(game.garageService.serviced, true);
  assert.equal(car.health, game.maxHealth); assert.equal(car.engineHealth, 100); assert.equal(car.handlingHealth, 100); assert.equal(game.heat, 0);
  assert.equal(game.particles.length, 0);
  const midpointEvents = game.drainEvents();
  assert.equal(midpointEvents.filter(event => event.type === 'sound' && event.name === 'repair').length, 1);
  assert.equal(midpointEvents.some(event => event.type === 'toast' && /Back on the road/.test(event.text)), false);
  advance(game, .94);
  assert.equal(game.garageTransition.phase, 'fade-in'); assert.equal(game.garageTransition.door, 1);
  assert.ok(game.garageTransition.opacity > 0 && game.garageTransition.opacity < 1);
  advance(game, .75);
  assert.equal(game.garageTransition.phase, 'opening'); assert.equal(game.garageTransition.opacity, 0);
  assert.ok(game.garageTransition.door > 0 && game.garageTransition.door < 1);
  assert.equal(game.interact(), false); assert.equal(game.player.vehicleId, car.id);
  advance(game, .46);
  assert.equal(game.garageService, null); assert.equal(game.garageTransition, null); assert.equal(game.money, 125);
  assert.ok(game.particles.length > 0);
  const completeEvents = game.drainEvents();
  assert.equal(completeEvents.filter(event => event.type === 'toast' && /Back on the road/.test(event.text)).length, 1);
  assert.equal(completeEvents.filter(event => event.type === 'sound' && event.name === 'repair').length, 0);
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null);
});

test('repair service charges once and freezes driving, world timers and other actions until the doors reopen', () => {
  const { game, service, car } = transitionFixture(); game.acceptMission('delivery'); game.score = 80;
  game.player.composure = 40; game.inventory.unlocked.push('cannon');
  game.projectiles.push({ id: 'frozen-projectile', x: 400, y: 400, vx: 100, vy: 0, life: 1, maxLife: 1 });
  assert.equal(game._useService(service), true);
  const snapshot = () => JSON.parse(JSON.stringify({ time: game.time, mission: game.mission,
    cars: game.cars, peds: game.peds, police: game.police, player: game.player, projectiles: game.projectiles,
    score: game.score, pockets: game.inventory.pockets, cooldown: game._actionCooldown, grace: game.graceTimer }));
  const before = snapshot();
  assert.equal(game._useService(service), false); assert.equal(game.interact(), false); assert.equal(game.recover(), false);
  for (const pocket of ['biscuits', 'repairTape', 'refill']) assert.equal(game.usePocket(pocket), false, pocket);
  advance(game, .8, { up: true, right: true, boost: true, brake: true });
  assert.equal(game.garageTransition.phase, 'closing'); assert.deepEqual(snapshot(), before); assert.equal(game.money, 125);
  game.update(NaN, { up: true }); game.update(-1, { up: true });
  assert.deepEqual(snapshot(), before); assert.ok(Math.abs(game.garageService.elapsed - .8) < 1e-9);
  advance(game, GARAGE_SERVICE_TIMING.duration - .8);
  assert.equal(game.garageService, null); assert.equal(game.time, before.time);
  assert.equal(game.mission.timeLeft, before.mission.timeLeft);
  assert.equal(game.player.vehicleId, car.id); assert.equal(game.money, 125);
  advance(game, .2, { up: true }); assert.ok(game.time > before.time); assert.ok(car.speed > 0);
});

test('garage service is transient and loading progress always starts with an open, visible garage', () => {
  const { game, service } = transitionFixture();
  assert.equal(game._useService(service), true); advance(game, .7);
  assert.equal(game.exportSave().money, 200, 'reload cannot charge for an unfinished repair');
  assert.equal(game.money, 125, 'the active game still reserves the payment exactly once');
  advance(game, 1);
  const saved = game.exportSave();
  assert.equal(saved.money, 125, 'a completed repair remains paid in saved progress');
  assert.equal(saved.garageService, undefined); assert.equal(saved.garageTransition, undefined);
  const loaded = makeFlatGame(); assert.equal(loaded.loadSave({ ...saved, garageService: game.garageService }), true);
  assert.equal(loaded.garageService, null); assert.equal(loaded.garageTransition, null);
  assert.equal(game.loadSave(saved), true); assert.equal(game.garageService, null); assert.equal(game.garageTransition, null);
});
