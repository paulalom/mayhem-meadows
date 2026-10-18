'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PAINT_COLORS } = require('../core.js');

function fixture(index = 0, deploy = true) {
  const game = new Game({ seed: 42 }), source = game.cars.filter(car => car.militaryModel === 'utility-truck')[index];
  assert.ok(source, 'an actual base utility must exist');
  game.cars = deploy ? [source] : []; game.police = []; game.peds = []; game.buildings = []; game.staticObjects = [];
  game.terrain = null; game.world = { ...game.world, terrain: null }; game.money = 500;
  const garage = game.services.find(service => service.id === 'garage');
  Object.assign(game.player, { x: garage.x + 90, y: garage.y, elevation: 0, grounded: true, vehicleId: null });
  if (deploy) {
    Object.assign(source, { x: garage.x, y: garage.y, angle: -Math.PI / 2, elevation: 0, speed: 0, vx: 0, vy: 0 });
    game.player.vehicleId = source.id; game.player.x = source.x; game.player.y = source.y;
  }
  game.vehiclePhysics.sync();
  if (deploy) game.vehiclePhysics.reset(source);
  assert.equal(game.garageAvailable, true);
  return { game, truck: source };
}
const serialized = game => JSON.parse(JSON.stringify(game.exportSave()));

test('both original olive utility variants retain their model, damage and collection identity across garage reloads', () => {
  for (const [index, color] of ['#73806a', '#8c9275'].entries()) {
    const { game, truck } = fixture(index);
    Object.assign(truck, { health: 63, engineHealth: 45, handlingHealth: 67 });
    assert.equal(game.garageStore(), true); const id = truck.garageId, count = game.cars.length;
    const saved = serialized(game), record = saved.garage.cars[0];
    assert.equal(record.id, id); assert.equal(record.militaryModel, 'utility-truck'); assert.equal(record.modelId, 'tumble-hauler'); assert.equal(record.color, color);
    assert.equal(record.health, 63); assert.equal(record.engineHealth, 45); assert.equal(record.handlingHealth, 67);
    assert.equal(game.garageRetrieve(id), true); assert.equal(game.current, truck); assert.equal(game.cars.length, count);
    assert.equal(truck.militaryModel, 'utility-truck'); assert.equal(truck.color, color); assert.equal(truck.health, 63);
    const { game: copy } = fixture(index, false);
    assert.equal(copy.loadSave(saved), true); assert.equal(copy.garage.cars.length, 1);
    assert.equal(copy.garageRetrieve(id), true);
    const retrieved = copy.current;
    assert.equal(retrieved.garageId, id); assert.equal(retrieved.militaryModel, 'utility-truck'); assert.equal(retrieved.modelId, 'tumble-hauler');
    assert.equal(retrieved.color, color); assert.equal(retrieved.health, 63); assert.equal(retrieved.engineHealth, 45); assert.equal(retrieved.handlingHealth, 67);
    assert.equal(copy.garageRetrieve(id), true); assert.equal(copy.current, retrieved); assert.equal(copy.cars.length, 1);
    assert.equal(copy.exportSave().garage.cars[0].militaryModel, 'utility-truck');
  }
});

test('a collected military utility keeps its variant through standard paint, repairs and a second save', () => {
  const { game, truck } = fixture();
  Object.assign(truck, { health: 40, engineHealth: 15, handlingHealth: 50 });
  assert.equal(game.garageStore(), true); const id = truck.garageId;
  assert.equal(game.garagePaint(id, PAINT_COLORS[1]), true);
  assert.equal(truck.color, PAINT_COLORS[1]); assert.equal(truck.militaryModel, 'utility-truck'); assert.equal(game.money, 475);
  const { game: copy } = fixture(0, false);
  assert.equal(copy.loadSave(serialized(game)), true); assert.equal(copy.garageRetrieve(id), true);
  const retrieved = copy.current;
  assert.equal(retrieved.color, PAINT_COLORS[1]); assert.equal(retrieved.militaryModel, 'utility-truck'); assert.equal(retrieved.health, 40);
  assert.equal(copy.garageRepair(id), true); assert.equal(copy.money, 430);
  assert.equal(retrieved.health, copy.maxHealth); assert.equal(retrieved.engineHealth, 100); assert.equal(retrieved.handlingHealth, 100);
  assert.equal(retrieved.militaryModel, 'utility-truck'); assert.equal(retrieved.modelId, 'tumble-hauler'); assert.equal(retrieved.color, PAINT_COLORS[1]);
  assert.equal(copy.garageRepair(id), false); assert.equal(copy.money, 430);
  const repaired = serialized(copy).garage.cars[0];
  assert.equal(repaired.militaryModel, 'utility-truck'); assert.equal(repaired.modelId, 'tumble-hauler'); assert.equal(repaired.color, PAINT_COLORS[1]);
  assert.equal(repaired.health, copy.maxHealth); assert.equal(repaired.engineHealth, 100); assert.equal(repaired.handlingHealth, 100);
});

test('save validation permits olive paint only for the whitelisted utility variant with a valid van model', () => {
  const { game } = fixture(0, false);
  const base = { id: 'ride-1', kind: 'van', modelId: 'tumble-hauler', militaryModel: 'utility-truck', color: '#73806a', health: 80 };
  const load = record => { assert.equal(game.loadSave({ version: 2, garage: { cars: [record] } }), true); return game.garage.cars; };
  for (const patch of [
    { militaryModel: undefined }, { militaryModel: 'unknown-truck' }, { militaryModel: 'constructor' },
    { kind: 'compact', modelId: 'bramble-pocket-rocket' }, { modelId: 'bramble-pocket-rocket' },
    { modelId: 'unknown-van' }, { modelId: '__proto__' }, { color: '#123456' }
  ]) assert.equal(load({ ...base, ...patch }).length, 0, JSON.stringify(patch));
  for (const modelId of ['tumble-hauler', 'mirth-party-wagon']) {
    const records = load({ ...base, modelId }); assert.equal(records.length, 1); assert.equal(records[0].militaryModel, 'utility-truck'); assert.equal(records[0].modelId, modelId);
  }
  const civilian = load({ ...base, militaryModel: 'unknown-truck', color: PAINT_COLORS[0] });
  assert.equal(civilian.length, 1); assert.equal(civilian[0].militaryModel, undefined);
  const mismatched = load({ ...base, kind: 'compact', modelId: 'bramble-pocket-rocket', color: PAINT_COLORS[0] });
  assert.equal(mismatched.length, 1); assert.equal(mismatched[0].militaryModel, undefined);
});

test('loading a legacy garage record preserves an existing utility instance and restores its variant on the next save', () => {
  const { game, truck } = fixture();
  assert.equal(game.garageStore(), true); const saved = serialized(game), id = truck.garageId;
  delete saved.garage.cars[0].militaryModel; saved.garage.cars[0].color = PAINT_COLORS[2];
  assert.equal(game.loadSave(saved), true); assert.equal(truck.militaryModel, 'utility-truck');
  assert.equal(game.garageRetrieve(id), true); assert.equal(game.current, truck); assert.equal(game.cars.length, 1);
  assert.equal(truck.color, PAINT_COLORS[2]); assert.equal(truck.militaryModel, 'utility-truck');
  assert.equal(serialized(game).garage.cars[0].militaryModel, 'utility-truck');
});
