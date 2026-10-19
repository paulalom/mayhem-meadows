'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../core.js');
const World = require('../world.js');
const Railway = require('../railway.js');

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
  }
  Object.assign(car, point(0, 0), { elevation: service.elevation, speed: 0 });
  game.player.vehicleId = null; assert.equal(game._useService(service), false); assert.equal(game.money, 200);
  game.player.vehicleId = car.id; game.money = 74;
  assert.equal(game._useService(service), false); assert.equal(game.money, 74);
  game.money = 200; assert.equal(game.interact(), true);
  assert.equal(game.money, 125); assert.equal(game.heat, 0);
  assert.equal(car.health, game.maxHealth); assert.equal(car.engineHealth, 100); assert.equal(car.handlingHealth, 100);
  assert.equal(game.player.vehicleId, car.id);
  assert.equal(game._useService(service), false); assert.equal(game.money, 125);
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null);
});
