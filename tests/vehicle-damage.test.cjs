'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, VehicleStats, CAR_MODELS } = require('../core.js');

function empty() {
  const game = new Game({ seed: 42 });
  game.cars = []; game.police = []; game.peds = []; game.buildings = []; game.staticObjects = [];
  game.player.x = 1100; game.player.y = 1100; game.graceTimer = 0;
  game.vehiclePhysics.sync();
  return game;
}
function car(game, x = 900, kind = 'compact') { return game._addCar(x, 900, 0, kind, '#ffd15b'); }

test('town makes and models vary deterministically, with initialized component health', () => {
  const first = new Game({ seed: 42 }), second = new Game({ seed: 42 });
  assert.deepEqual(first.cars.map(value => value.modelId), second.cars.map(value => value.modelId));
  assert.ok(new Set(first.cars.map(value => value.modelId)).size >= 5);
  for (const value of first._vehicles()) {
    assert.ok(CAR_MODELS[value.modelId]); assert.equal(value.engineHealth, 100);
    assert.equal(value.handlingHealth, 100); assert.equal(value.burning, false);
    assert.equal(VehicleStats.condition(value), 1);
  }
});

test('impacts damage each civilian and patrol independently, without duplicate contact damage', () => {
  const game = empty(), a = car(game), b = car(game, 960);
  const cop = { ...game._vehicleState('compact'), id: 'police-100', x: 1050, y: 900, angle: 0, speed: 0, route: [] };
  game.police = [cop];
  for (const value of [a, b, cop]) game._impact(value, 230, true);
  for (const value of [a, b, cop]) {
    assert.ok(value.health < 100 && value.engineHealth < 100 && value.handlingHealth < 100);
    assert.ok(game.vehicleStats(value).acceleration < VehicleStats.getModel(value).acceleration);
  }
  const damaged = a.health; game._impact(a, 230, true); assert.equal(a.health, damaged);
  game.time += 0.61; game._impact(a, 230, true); assert.ok(a.health < damaged);
  assert.equal(game.heat, 0); assert.equal(game.player.vehicleId, null);
});

test('real rigid body contacts damage both cars while a low speed tap stays cosmetic', () => {
  const game = empty(), a = car(game, 850), b = car(game, 920);
  a.speed = a.vx = 260;
  for (let i = 0; i < 35; i++) game.update(1 / 60);
  assert.ok(a.health < 100, 'the moving chassis takes contact damage');
  assert.ok(b.health < 100, 'the struck chassis also takes contact damage');
  const c = car(game, 1300); game._impact(c, 64, false); assert.equal(c.health, 100);
});

test('critical engine damage warns before exactly one explosion and leaves a powerless wreck', () => {
  const game = empty(), value = car(game); game.player.x = value.x; game.player.y = value.y; game._damageVehicle(value, 75);
  assert.equal(value.burning, true); assert.equal(value.exploded, false);
  assert.ok(game.drainEvents().some(event => event.text?.includes('fire')));
  game._vehicleDamageStep(7.9); assert.equal(value.exploded, false);
  game._vehicleDamageStep(0.11); assert.equal(value.exploded, true);
  assert.equal(value.health, 0); assert.equal(value.engineHealth, 0); assert.equal(value.handlingHealth, 0);
  assert.equal(value.burning, false); assert.equal(game.vehicleStats(value).acceleration, 0);
  const velocity = game.vehiclePhysics.get(value.id).velocity.y;
  assert.ok(velocity > 0); assert.equal(game._explodeVehicle(value), false);
  game._vehicleDamageStep(10); assert.equal(game.vehiclePhysics.get(value.id).velocity.y, velocity);
});

test('burning drivers can bail out at speed and in the air; wrecking NPCs does not eject the player', () => {
  const game = empty(), driven = car(game), other = car(game, 1500);
  game.player.vehicleId = driven.id; Object.assign(game.player, { x: driven.x, y: driven.y });
  game._damageVehicle(other, 100); assert.equal(game.player.vehicleId, driven.id);
  game._damageVehicle(driven, 75); driven.speed = 230; driven.elevation = game.player.elevation = 2; driven.upright = false;
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null);
  assert.equal(game.player.elevation, 0); assert.equal(driven.burning, true);
  game.player.x = other.x; game.player.y = other.y; assert.equal(game.interact(), false);
});

test('explosions damage and push nearby cars, tumble people and respect distance and elevation', () => {
  const game = empty(), source = car(game), near = car(game, 955), far = car(game, 1200), high = car(game, 920);
  near.engineHealth = 35; high.elevation = 14;
  const ped = { id: 'ped-blast', x: 900, y: 970, angle: 0, elevation: 0, ragdollGrace: 0 };
  game.peds = [ped]; game.vehiclePhysics.sync();
  assert.equal(game._explodeVehicle(source), true);
  assert.ok(near.health < 100); assert.equal(near.burning, true); assert.equal(near.exploded, false);
  assert.equal(far.health, 100); assert.equal(high.health, 100);
  assert.ok(game.vehiclePhysics.get(near.id).velocity.x > 0);
  assert.ok(game.ragdolls.get(ped.id));
  assert.ok(game.vehicleStats(near).maxSpeed < VehicleStats.getModel(near).maxSpeed);
});

test('repair tape restores damaged components on a full hull and cancels the fire countdown', () => {
  const game = empty(), value = car(game); game.player.vehicleId = value.id;
  value.engineHealth = 0; value.handlingHealth = 40; value.burning = true; value.fireTime = 7.8;
  assert.equal(game.usePocket('repairTape'), true);
  assert.equal(value.engineHealth, 55); assert.equal(value.handlingHealth, 95);
  assert.equal(value.burning, false); game._vehicleDamageStep(1); assert.equal(value.exploded, false);
  assert.equal(game.inventory.pockets.repairTape, 0);
});

test('recovery rights a damaged ride without healing its engine or putting out its fire', () => {
  const game = new Game({ seed: 42 }); game.interact(); const value = game.current;
  value.health = 15; value.engineHealth = 7; value.handlingHealth = 18; value.burning = true; value.fireTime = 4;
  game.recover();
  assert.equal(value.health, 15); assert.equal(value.engineHealth, 7); assert.equal(value.handlingHealth, 18);
  assert.equal(value.burning, true); assert.equal(value.fireTime, 4); assert.equal(value.upright, true);
});

test('collection preserves the model and component damage, and repairs stored fire/wreck state', () => {
  const game = empty(), value = car(game); game.player.vehicleId = value.id;
  Object.assign(game.player, { x: 900, y: 900 }); value.modelId = 'pogo-streetbug';
  value.health = 68; value.engineHealth = 30; value.handlingHealth = 48;
  assert.equal(game.garageStore(), true); const id = value.garageId;
  const save = game.exportSave(), copy = empty(); copy.player.x = copy.player.y = 900;
  assert.equal(copy.loadSave(save), true); assert.equal(copy.garageRetrieve(id), true);
  assert.equal(copy.current.modelId, value.modelId); assert.equal(copy.current.engineHealth, 30);
  assert.equal(copy.current.handlingHealth, 48); assert.equal(copy.current.health, 68);
  game._damageVehicle(value, 30); assert.equal(value.burning, true);
  const burning = game.exportSave(), restored = empty(); restored.player.x = restored.player.y = 900;
  restored.loadSave(burning); assert.equal(restored.garageRetrieve(id), false);
  assert.equal(restored.garageRepair(id), true); assert.equal(restored.garageRetrieve(id), true);
  assert.equal(restored.current.engineHealth, 100); assert.equal(restored.current.handlingHealth, 100);
  assert.equal(restored.current.burning, false); assert.equal(restored.current.exploded, false);
});

test('legacy and hostile model/component saves migrate to valid, bounded states', () => {
  const game = empty();
  game.loadSave({ version: 2, garage: { cars: [
    { id: 'ride-1', kind: 'van', color: '#ffd15b', health: 50 },
    { id: 'ride-2', kind: 'compact', modelId: '__proto__', color: '#ffd15b', health: 75, engineHealth: Infinity, handlingHealth: -15, fireTime: 1e20, burning: true },
    { id: 'ride-3', kind: 'sports', modelId: 'pogo-streetbug', color: '#ffd15b', health: 100, engineHealth: 1e20, handlingHealth: NaN }
  ] } });
  assert.equal(game.garage.cars[0].engineHealth, 50);
  assert.equal(VehicleStats.getModel(game.garage.cars[1]).kind, 'compact');
  assert.equal(game.garage.cars[1].engineHealth, 75); assert.equal(game.garage.cars[1].handlingHealth, 0);
  assert.equal(game.garage.cars[1].fireTime, 8); assert.equal(game.garage.cars[2].engineHealth, 100);
  assert.equal(VehicleStats.getModel(game.garage.cars[2]).kind, 'sports');
  assert.equal(game.exportSave().garage.cars.some(record => 'explosionTime' in record), false);
});

test('disabled patrols retain bounded visible wrecks while replacements keep the chase active', () => {
  const game = new Game({ seed: 42 }); game.heat = 2;
  game._updatePolice(1 / 60);
  const wreck = game.police[0]; wreck.health = 0; wreck.exploded = true;
  const burning = game.police[1]; burning.burning = true;
  game._updatePolice(1 / 60);
  assert.ok(game.police.includes(wreck) && game.police.includes(burning));
  assert.equal(game.police.filter(value => value.health > 0 && !value.burning && !value.exploded).length, 2);
  for (let i = 0; i < 8; i++) {
    const active = game.police.find(value => value.health > 0 && !value.burning && !value.exploded);
    active.health = 0; active.exploded = true; game._updatePolice(1 / 60);
  }
  assert.equal(game.police.length, 5);
});
