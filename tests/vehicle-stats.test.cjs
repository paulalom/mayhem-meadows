'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Stats = require('../vehicle-stats.js');

test('civilian vehicle kinds retain two fictional models and their familiar driving stats', () => {
  for (const kind of ['compact', 'sports', 'van']) {
    const models = Object.values(Stats.CAR_MODELS).filter(model => model.kind === kind);
    assert.equal(models.length, 2);
    const base = Stats.getModel({ kind });
    assert.equal(base.name, Stats.CAR_TYPES[kind].name);
    for (const field of ['maxSpeed', 'acceleration', 'handling', 'grip', 'mass', 'width', 'length']) assert.equal(base[field], Stats.CAR_TYPES[kind][field]);
    assert.ok(models.every(model => model.make && model.model && model.durability > 0 && model.engineDurability > 0));
    assert.notEqual(models[0].maxSpeed, models[1].maxSpeed);
  }
  assert.equal(Stats.getModel({ kind: 'police' }).kind, 'compact');
  assert.equal(Stats.getModel({ kind: 'van', modelId: 'fable-comet-rs' }).id, Stats.DEFAULT_MODELS.van);
  assert.equal(Stats.getModel({ kind: 'compact', modelId: '__proto__' }).id, Stats.DEFAULT_MODELS.compact);
  assert.equal(Stats.getModel({ kind: 'sports', modelId: 'fable-comet-rs' }).maxSpeed, 400);
  assert.equal(Object.values(Stats.CAR_MODELS).filter(model => model.kind === 'tank').length, 1);
  assert.equal(Stats.getModel({ kind: 'tank' }).id, 'northwatch-warden');
});

test('hull and component damage separately degrade performance, with bounded invalid save values', () => {
  const healthy = Stats.performance({ kind: 'compact' });
  const hullDamage = Stats.performance({ kind: 'compact', health: 50, maxHealth: 100 });
  const engineDamage = Stats.performance({ kind: 'compact', engineHealth: 50 });
  const steeringDamage = Stats.performance({ kind: 'compact', handlingHealth: 50 });
  assert.equal(healthy.acceleration, Stats.CAR_TYPES.compact.acceleration);
  for (const field of ['acceleration', 'maxSpeed', 'handling', 'grip']) assert.ok(hullDamage[field] < healthy[field]);
  assert.ok(engineDamage.acceleration < healthy.acceleration && engineDamage.maxSpeed < healthy.maxSpeed);
  assert.equal(engineDamage.handling, healthy.handling);
  assert.ok(steeringDamage.handling < healthy.handling && steeringDamage.grip < healthy.grip);
  assert.equal(steeringDamage.maxSpeed, healthy.maxSpeed);
  assert.equal(Stats.condition({ health: 75, maxHealth: 150 }), 0.5);
  const corrupt = Stats.performance({ health: -50, engineHealth: -1, handlingHealth: 200 });
  assert.equal(corrupt.engineHealth, 0); assert.equal(corrupt.handlingHealth, 100);
  assert.equal(corrupt.acceleration, 0); assert.equal(corrupt.maxSpeed, 0); assert.equal(corrupt.driveable, false);
  assert.equal(Stats.performance({ health: 100, exploded: true }).driveable, false);
  assert.ok(Number.isFinite(Stats.performance({ health: NaN, maxHealth: 0, engineHealth: Infinity }).maxSpeed));
});

test('condition labels include hidden component damage, fire, and wrecks', () => {
  assert.equal(Stats.status({}), 'Pristine');
  assert.equal(Stats.status({ health: 80 }), 'Dented');
  assert.equal(Stats.status({ engineHealth: 40 }), 'Damaged');
  assert.equal(Stats.status({ handlingHealth: 10 }), 'Critical');
  assert.equal(Stats.status({ burning: true }), 'On fire');
  assert.equal(Stats.status({ burning: true, health: 0 }), 'Wrecked');
  assert.equal(Stats.status({ exploded: true }), 'Wrecked');
  assert.equal(Stats.isDamaged({}), false);
  assert.equal(Stats.isDamaged({ health: 100, engineHealth: 99 }), true);
  assert.equal(Stats.isDamaged({ health: 100, handlingHealth: 99 }), true);
});

test('partial repairs restore each subsystem and extinguish recoverable fires; full repairs clear wreck state', () => {
  const car = { health: 10, maxHealth: 100, engineHealth: 5, handlingHealth: 20, burning: true, fireTime: 2, exploded: false };
  Stats.repair(car, 100, 10);
  assert.equal(car.health, 20); assert.equal(car.engineHealth, 15); assert.equal(car.handlingHealth, 30); assert.equal(car.burning, true);
  Stats.repair(car, 100, 20);
  assert.equal(car.health, 40); assert.equal(car.engineHealth, 35); assert.equal(car.handlingHealth, 50); assert.equal(car.burning, false); assert.equal(car.fireTime, 0);
  car.exploded = true; car.health = 0; car.burning = true; car.fireTime = 5; car.explosionTime = 2;
  Stats.repair(car, 125);
  assert.equal(car.health, 125); assert.equal(car.maxHealth, 125); assert.equal(car.engineHealth, 100); assert.equal(car.handlingHealth, 100);
  assert.equal(car.burning, false); assert.equal(car.exploded, false); assert.equal(car.fireTime, 0); assert.equal(Stats.isDamaged(car), false);
  assert.equal(Object.hasOwn(car, 'explosionTime'), false);
});

test('zero or invalid repair amounts do not extinguish fires or restore condition', () => {
  const car = { health: 60, engineHealth: 60, handlingHealth: 60, burning: true, fireTime: 2 };
  Stats.repair(car, 100, NaN);
  assert.equal(car.health, 60); assert.equal(car.engineHealth, 60); assert.equal(car.handlingHealth, 60); assert.equal(car.burning, true); assert.equal(car.fireTime, 2);
});

test('repair points restore the same component health on armored vehicles', () => {
  const car = { health: 40, maxHealth: 175, engineHealth: 10, handlingHealth: 20, burning: true, fireTime: 2 };
  Stats.repair(car, 175, 55);
  assert.equal(car.health, 95); assert.equal(car.engineHealth, 65); assert.equal(car.handlingHealth, 75);
  assert.equal(car.burning, false); assert.equal(car.fireTime, 0);
});
