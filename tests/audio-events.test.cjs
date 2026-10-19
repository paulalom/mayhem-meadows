'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PAINT_COLORS, GARAGE_SERVICE_TIMING } = require('../core.js');
const { makeFlatGame } = require('./helpers/flat-game.cjs');

const empty = () => {
  const game = makeFlatGame();
  game.cars = []; game.police = []; game.peds = []; game.buildings = []; game.staticObjects = [];
  Object.assign(game.player, { x: 900, y: 900, angle: 0 });
  game.graceTimer = 0; game.vehiclePhysics.sync(); game.drainEvents();
  return game;
};
const sounds = game => game.drainEvents().filter(event => event.type === 'sound');
const advance = (game, seconds, input = {}) => {
  for (let elapsed = 0; elapsed < seconds - .000001; elapsed += 1 / 60) game.update(1 / 60, input);
};
const ride = game => {
  const car = game._addCar(900, 900, 0, 'compact', PAINT_COLORS[0]);
  game.player.vehicleId = car.id;
  return car;
};

test('cannon launch, traveling burst and empty trigger have distinct sounds at their sources', () => {
  const game = empty(); game.inventory.unlocked.push('cannon'); game.equipGadget('cannon');
  game.inventory.ammo.cannon = 1; game.drainEvents();
  assert.equal(game.action(0), true);
  assert.deepEqual(sounds(game), [{ type: 'sound', name: 'cannon', details: { x: 900, y: 900 } }]);
  assert.equal(game.action(0), false); assert.deepEqual(sounds(game), [], 'cooldown ignores the held trigger');
  advance(game, .7);
  const burst = sounds(game).find(event => event.name === 'party');
  assert.ok(burst); assert.ok(burst.details.x > 1200); assert.equal(burst.details.y, 900);
  game._actionCooldown = 0;
  assert.equal(game.action(0), false);
  assert.deepEqual(sounds(game), [{ type: 'sound', name: 'empty', details: { x: 900, y: 900 } }]);
  assert.equal(game.projectiles.length, 0); assert.equal(game._actionCooldown, 0);
});

test('equipping sounds only on an actual change, including the first purchased toy', () => {
  const game = empty(); game.money = 1000;
  assert.equal(game.equipGadget('popper'), true); assert.equal(game.equipGadget('cannon'), false);
  assert.deepEqual(sounds(game), []);
  assert.equal(game.purchaseGadget('hammer'), true);
  assert.deepEqual(sounds(game).map(event => event.name), ['equip', 'purchase']);
  assert.equal(game.equipGadget('hammer'), true); assert.equal(game.purchaseGadget('hammer'), false);
  assert.deepEqual(sounds(game), []);
  assert.equal(game.equipGadget('popper'), true);
  assert.deepEqual(sounds(game), [{ type: 'sound', name: 'equip', details: { gadget: 'popper' } }]);
  game.flop(); game.drainEvents();
  assert.equal(game.equipGadget('hammer'), false); assert.deepEqual(sounds(game), []);
});

test('pocket items use physical cues only when an item is actually spent', () => {
  const game = empty();
  assert.equal(game.usePocket('biscuits'), false); assert.equal(game.usePocket('repairTape'), false);
  assert.equal(game.usePocket('refill'), false); assert.deepEqual(sounds(game), []);
  game.player.composure = 30; assert.equal(game.usePocket('biscuits'), true);
  const car = ride(game); car.engineHealth = 35; assert.equal(game.usePocket('repairTape'), true);
  game.inventory.unlocked.push('cannon'); assert.equal(game.usePocket('refill'), true);
  assert.deepEqual(sounds(game).map(event => event.name), ['biscuit', 'tape', 'refill']);
  assert.equal(game.usePocket('repairTape'), false); assert.deepEqual(sounds(game), []);
});

test('workshop service, collection repairs and paint have dedicated cues and failed services stay silent', () => {
  const game = empty(), car = ride(game); game.money = 1000;
  assert.equal(game.purchase('repair'), false); assert.deepEqual(sounds(game), []);
  car.health = 40;
  assert.equal(game.purchase('repair'), true); assert.equal(game.garageStore(), true);
  const id = car.garageId; game.drainEvents();
  car.handlingHealth = 40;
  assert.equal(game.garageRepair(id), true);
  assert.equal(game.garagePaint(id, PAINT_COLORS[1]), true);
  assert.equal(game.garagePaint(id, PAINT_COLORS[1]), false);
  assert.deepEqual(sounds(game).map(event => event.name), ['repair', 'paint']);
  game.heat = 1;
  const garage = game.services.find(service => service.id === 'repair');
  Object.assign(car, { x: garage.x, y: garage.y });
  assert.equal(game._useService(garage), true);
  assert.deepEqual(sounds(game), []);
  advance(game, GARAGE_SERVICE_TIMING.blackAt + .01);
  assert.deepEqual(sounds(game), [{ type: 'sound', name: 'repair', details: { x: garage.x, y: garage.y } }]);
  assert.equal(game._useService(garage), false); assert.deepEqual(sounds(game), []);
});

test('broken scenery and vehicle contacts carry material, source and bounded impact strength', () => {
  const game = empty();
  for (const [kind, material] of [['fence', 'wood'], ['bench', 'wood'], ['lamp', 'metal'], ['wayfinding', 'metal'], ['fountain', 'stone'], ['tree', 'foliage']]) {
    const prop = { id: 'audio-' + kind, kind, x: 940, y: 930, health: 25, maxHealth: 25, parts: [{ offset: [0, .5, 0], half: [.3, .5, .3] }] };
    game.staticObjects = [prop];
    assert.equal(game._damageProp(prop, 30, game.player, false), true);
    const event = sounds(game).find(value => value.name === 'crash');
    assert.deepEqual(event.details, { x: 940, y: 930, sourceId: prop.id, destroyed: true, intensity: 1, material });
    assert.equal(game._damageProp(prop, 30), false); assert.deepEqual(sounds(game), []);
  }
  game.staticObjects = []; const car = ride(game);
  game._impact(car, 30, true); assert.deepEqual(sounds(game), []);
  game._impact(car, 64, true);
  assert.equal(sounds(game).filter(event => event.name === 'crash').length, 1);
  assert.equal(car.health, 100); assert.equal(car.engineHealth, 100); assert.equal(car.handlingHealth, 100);
  game._impact(car, 64, true); assert.deepEqual(sounds(game), [], 'small taps have their own audio debounce');
  game.time += .3;
  game._impact(car, 165, true);
  assert.deepEqual(sounds(game).find(event => event.name === 'crash').details, { x: car.x, y: car.y, sourceId: car.id, intensity: .5, material: 'vehicle' });
  const health = car.health; assert.ok(health < 100);
  game._impact(car, 300, true); assert.deepEqual(sounds(game), [], 'one contact cannot retrigger during debounce');
  game.time += .3; game._impact(car, 300, true); assert.deepEqual(sounds(game), []);
  assert.equal(car.health, health, 'sound debounce never shortens the damage cooldown');
});

test('fire warning and explosion each occur once instead of reusing a crash', () => {
  const game = empty(), car = ride(game); game.player.x = 1300;
  game._damageVehicle(car, 75);
  assert.equal(car.burning, true);
  assert.deepEqual(sounds(game).map(event => event.name), ['fire-start']);
  game._damageVehicle(car, 1); assert.deepEqual(sounds(game), []);
  game._vehicleDamageStep(7.9); assert.deepEqual(sounds(game), []);
  game._vehicleDamageStep(.2);
  const events = sounds(game);
  assert.equal(events.filter(event => event.name === 'explosion').length, 1);
  assert.ok(!events.some(event => event.name === 'crash'));
  assert.equal(game._explodeVehicle(car), false); game._vehicleDamageStep(10); assert.deepEqual(sounds(game), []);
});

test('real solver contacts retain the struck scenery material and individual car sources', () => {
  for (const material of ['wood', 'vehicle']) {
    const game = empty(), moving = game._addCar(850, 900, 0, 'compact', PAINT_COLORS[0]);
    game.player.vehicleId = moving.id;
    if (material === 'wood') {
      game.staticObjects = [{ id: 'solid-fence', kind: 'fence', x: 960, y: 900, elevation: 0, health: 1000, maxHealth: 1000,
        parts: [{ offset: [0, 1, 0], half: [.3, 1, 3] }] }];
    } else game._addCar(920, 900, 0, 'compact', PAINT_COLORS[1]);
    moving.speed = moving.vx = 260;
    advance(game, .65);
    const impacts = sounds(game).filter(event => event.name === 'crash');
    assert.ok(impacts.length > 0, material + ' produces a real contact cue');
    assert.ok(impacts.every(event => event.details.material === material));
    assert.ok(impacts.every(event => event.details.destroyed !== true), 'solid contacts do not claim scenery broke');
    assert.ok(impacts.every(event => game.cars.some(car => car.id === event.details.sourceId)));
    if (material === 'vehicle') assert.ok(impacts.length >= 2, 'both struck chassis have their own source');
    for (const impact of impacts) assert.ok(Number.isFinite(impact.details.x) && Number.isFinite(impact.details.y));
  }
});

test('residents speak their displayed reaction only after a successful knockdown', () => {
  const game = empty();
  const person = { id: 'resident-audio', x: 980, y: 920, elevation: 0, angle: 0, ragdollGrace: 0 };
  game.peds = [person];
  assert.equal(game._startle(person, 0), true);
  const events = sounds(game);
  assert.equal(events.filter(event => event.name === 'flop').length, 1);
  assert.deepEqual(events.find(event => event.name === 'resident').details, { x: person.x, y: person.y, text: person.bubble, id: person.id });
  assert.equal(game._startle(person, 0), false); assert.deepEqual(sounds(game), []);
  assert.equal(game.flop(), true); assert.ok(!sounds(game).some(event => event.name === 'resident'));
});

test('landings follow downward speed and never repeat while standing or following slopes', () => {
  const game = empty();
  const surfaceHeight = (x, y) => (x + y) / 300;
  const count = 5, step = 500, heights = new Float32Array(count * count);
  for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) heights[row * count + column] = surfaceHeight(column * step, row * step);
  game.terrain = game.world.terrain = { count, step, heights, surfaceHeight, heightAt: surfaceHeight, isWater: () => false };
  game.vehiclePhysics.sync();
  game.player.elevation = game._ground(game.player);
  for (let frame = 0; frame < 90; frame++) game._walk(1 / 60, frame < 30 ? {} : { right: true });
  assert.deepEqual(sounds(game), []);
  assert.equal(game.jump(), true);
  for (let frame = 0; frame < 90; frame++) game._walk(1 / 60, {});
  const lands = sounds(game).filter(event => event.name === 'land');
  assert.equal(lands.length, 1); assert.ok(lands[0].details.intensity > .5 && lands[0].details.intensity < .8);
  Object.assign(game.player, { elevation: game._ground(game.player) + .05, verticalVelocity: -12, grounded: false });
  game._walk(1 / 60, { right: true });
  assert.equal(sounds(game).find(event => event.name === 'land').details.intensity, 1, 'moving support cannot erase the impact velocity');
  game._walk(1 / 60, { right: true }); assert.deepEqual(sounds(game), []);
});

test('a splash comes from the submerged entity once per immersion, before recovery', () => {
  const game = empty(), car = ride(game);
  game.world.terrain = { waterLevel: 0, isWater: x => x < 700, surfaceHeight: x => x < 700 ? -4 : 0 };
  Object.assign(car, { x: 540, y: 900, elevation: 2 });
  game._waterRecovery(.2); assert.deepEqual(sounds(game), [], 'a car on a bridge does not splash');
  car.elevation = -4; car.verticalVelocity = -6;
  game._waterRecovery(.2);
  assert.deepEqual(sounds(game), [{ type: 'sound', name: 'splash', details: { x: 540, y: 900, intensity: .5 } }]);
  assert.equal(car.x, 540, 'entry is audible before the recovery delay');
  game._waterRecovery(.2); assert.deepEqual(sounds(game), []);
  game._waterRecovery(.2); assert.ok(car.x >= 700); assert.deepEqual(sounds(game), []);
  Object.assign(car, { x: 540, y: 900, elevation: -4 });
  game._waterRecovery(.1); assert.equal(sounds(game).filter(event => event.name === 'splash').length, 1);
  game._waterRecovery(.1); assert.deepEqual(sounds(game), []);
});

test('police search cues occur only on entry and reset after sight, escape, garage service or capture', () => {
  const game = empty(); game.money = 1000;
  const cop = { id: 'police-audio', ...game._vehicleState('compact'), x: 900, y: 180, angle: 0, speed: 0, routeTimer: 999, route: [{ x: 900, y: 180 }], lastSeen: { x: 900, y: 900 } };
  game.police = [cop]; game.heat = 1;
  game._updatePolice(.02); game._updatePolice(.02);
  assert.equal(sounds(game).filter(event => event.name === 'search').length, 1);
  cop.y = 650; game._updatePolice(.02); assert.equal(game.policeSeen, true); assert.deepEqual(sounds(game), []);
  cop.y = 180; game._updatePolice(.02);
  assert.equal(sounds(game).filter(event => event.name === 'search').length, 1);
  game.escapeTimer = game.escapeGoal - .01; game._updatePolice(.02);
  assert.equal(sounds(game).filter(event => event.name === 'escape').length, 1);
  game._updatePolice(.02); assert.deepEqual(sounds(game), []);
  game.heat = 1; game._updatePolice(.02); assert.equal(sounds(game).filter(event => event.name === 'search').length, 1);
  const service = game.services.find(value => value.id === 'repair');
  const car = game._addCar(service.x, service.y, 0, 'compact', PAINT_COLORS[0]); game.player.vehicleId = car.id;
  assert.equal(game._useService(service), true); advance(game, GARAGE_SERVICE_TIMING.duration + .01);
  game.player.vehicleId = null; game.drainEvents();
  game.heat = 1; game._updatePolice(.02); assert.equal(sounds(game).filter(event => event.name === 'search').length, 1);
  game._caught(); game.drainEvents(); game.heat = 1; game._updatePolice(.02);
  assert.equal(sounds(game).filter(event => event.name === 'search').length, 1);
  if (game._applyReportedHeat) game._applyReportedHeat(1, 'New commotion.', game.player);
  else game._raiseHeat(1, 'New commotion.');
  assert.deepEqual(sounds(game).find(event => event.name === 'heat').details, { level: 2, reason: 'New commotion.' });
  game._updatePolice(.02); game._updatePolice(.02);
  assert.equal(sounds(game).filter(event => event.name === 'search').length, 1);
});
