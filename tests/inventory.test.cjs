'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GADGETS, POCKET_ITEMS, PAINT_COLORS } = require('../core.js');
const { MUZZLE_HEIGHT } = require('../physics.js');
const { makeFlatGame: makeGame } = require('./helpers/flat-game.cjs');
const shop = game => { game.player.x = 900; game.player.y = 900; game.money = 2000; };
const advance = (game, seconds) => { for (let elapsed = 0; elapsed < seconds - 0.000001; elapsed += 1 / 60) game.update(1 / 60); };
const driveToGarage = game => {
  assert.equal(game.interact(), true);
  const car = game.current;
  car.x = game.player.x = 900; car.y = game.player.y = 900;
  car.speed = car.vx = car.vy = 0;
  return car;
};

test('toy unlocks and pocket shops enforce location, prices, capacity, and ownership', () => {
  const game = makeGame();
  assert.equal(game.garageAvailable, false);
  assert.equal(game.purchaseGadget('hammer'), false); assert.equal(game.purchasePocket('biscuits'), false);
  assert.equal(game.money, 150); assert.equal(game.equipGadget('cannon'), false);
  shop(game); assert.equal(game.garageAvailable, true);
  assert.equal(game.purchaseGadget('hammer'), true); assert.equal(game.money, 1880);
  assert.equal(game.inventory.equipped, 'hammer');
  assert.equal(game.purchaseGadget('hammer'), false); assert.equal(game.money, 1880);
  assert.equal(game.purchaseGadget('cannon'), true); assert.equal(game.money, 1600); assert.equal(game.inventory.ammo.cannon, 6);
  assert.equal(game.equipGadget('popper'), true); assert.equal(game.equipGadget('constructor'), false);
  for (let i = 0; i < 3; i++) assert.equal(game.purchasePocket('biscuits'), true);
  const cash = game.money; assert.equal(game.inventory.pockets.biscuits, 5);
  assert.equal(game.purchasePocket('biscuits'), false); assert.equal(game.money, cash);
  game.money = 10; assert.equal(game.purchasePocket('repairTape'), false); assert.equal(game.money, 10);
  assert.equal(game.purchasePocket('__proto__'), false);
  assert.equal(GADGETS.cannon.price, 280); assert.equal(POCKET_ITEMS.refill.cap, 3); assert.equal(PAINT_COLORS.length, 6);
});

test('consumables work away from shops and never spend stacks on unavailable or full targets', () => {
  const game = makeGame();
  assert.equal(game.usePocket('biscuits'), false); assert.equal(game.inventory.pockets.biscuits, 2);
  game.player.composure = 35; assert.equal(game.usePocket('biscuits'), true); assert.equal(game.player.composure, 75);
  assert.equal(game.usePocket('biscuits'), true); assert.equal(game.player.composure, 100);
  assert.equal(game.usePocket('biscuits'), false);
  assert.equal(game.usePocket('repairTape'), false); assert.equal(game.inventory.pockets.repairTape, 1);
  assert.equal(game.usePocket('refill'), false); assert.equal(game.inventory.pockets.refill, 1);
  game.interact(); const car = game.current;
  assert.equal(game.usePocket('repairTape'), false); car.health = 30;
  car.speed = 46; assert.equal(game.usePocket('repairTape'), false); assert.equal(car.health, 30); assert.equal(game.inventory.pockets.repairTape, 1);
  car.speed = 0;
  assert.equal(game.usePocket('repairTape'), true); assert.equal(car.health, 85); assert.equal(game.inventory.pockets.repairTape, 0);
  game.inventory.unlocked.push('cannon'); game.inventory.ammo.cannon = 9;
  assert.equal(game.usePocket('refill'), true); assert.equal(game.inventory.ammo.cannon, 12);
  game.inventory.pockets.refill = 1; assert.equal(game.usePocket('refill'), false); assert.equal(game.inventory.pockets.refill, 1);
});

test('fallen players cannot equip, use pockets, or shop, and moving drivers must stop at the garage', () => {
  const game = makeGame(); shop(game);
  game.player.composure = 40; assert.equal(game.flop(), true);
  const before = game.exportSave();
  assert.equal(game.equipGadget('popper'), false); assert.equal(game.usePocket('biscuits'), false);
  assert.equal(game.purchaseGadget('hammer'), false); assert.equal(game.purchasePocket('biscuits'), false);
  assert.equal(game.garageStore(), false); assert.equal(game.garageAvailable, false);
  assert.deepEqual(game.exportSave(), before);
  const driver = makeGame(), car = driveToGarage(driver); car.speed = 46;
  assert.equal(driver.garageAvailable, false); assert.equal(driver.garageStore(), false);
  car.speed = 45; assert.equal(driver.garageAvailable, true);
});

test('inflatable hammer has a short forward cone, a physical shove, and a distinct cooldown', () => {
  const game = makeGame(); shop(game); game.purchaseGadget('hammer');
  game.buildings = []; game.cars = []; game.police = []; game.player.x = 1080; game.player.y = 1080;
  game.peds = game.peds.slice(0, 3);
  Object.assign(game.peds[0], { x: 1120, y: 1080 });
  Object.assign(game.peds[1], { x: 1040, y: 1080 });
  Object.assign(game.peds[2], { x: 1160, y: 1080 });
  const cash = game.money;
  assert.equal(game.action(0), true); assert.ok(game.physics.get(game.peds[0].id));
  assert.equal(game.physics.get(game.peds[1].id), undefined); assert.equal(game.physics.get(game.peds[2].id), undefined);
  assert.equal(game._actionCooldown, 0.9); assert.equal(game.action(0), false); assert.equal(game.money, cash);
  assert.equal(game.heat, 0); assert.ok(game.peds[0].bubble.length > 0);
  game._updateWitnessReports(2); assert.equal(game.heat, 1);
});

test('Party Cannon travels before bursting, expends ammo, tumbles a crowd, and stops at obstacles', () => {
  const game = makeGame(); shop(game); game.purchaseGadget('cannon');
  game.buildings = []; game.cars = []; game.police = []; game.player.x = 1080; game.player.y = 1080;
  game.peds = game.peds.slice(0, 2);
  // The lob clears a standing head at its apex, then reaches the crowd on its
  // descending arc; the burst must still come from an actual 3D collision.
  Object.assign(game.peds[0], { x: 1450, y: 1080, pace: 0 });
  Object.assign(game.peds[1], { x: 1450, y: 1120, pace: 0 });
  assert.equal(game.action(0), true); assert.equal(game.inventory.ammo.cannon, 5); assert.equal(game.projectiles.length, 1);
  assert.equal(game.physics.bodies.size, 0); advance(game, 0.1);
  assert.ok(game.projectiles[0].x > 1105); assert.ok(game.projectiles[0].height > MUZZLE_HEIGHT);
  advance(game, 0.55); assert.equal(game.projectiles.length, 0); assert.equal(game.physics.bodies.size, 2);
  assert.equal(game.heat, 0); game._updateWitnessReports(2); assert.equal(game.heat, 1);
  game._actionCooldown = 0; game.inventory.ammo.cannon = 0;
  assert.equal(game.action(0), false); assert.equal(game._actionCooldown, 0);
  game.inventory.ammo.cannon = 1; game.peds = []; game.physics.clearAll();
  game.buildings = [{ x: 1150, y: 1000, w: 120, h: 160 }];
  assert.equal(game.action(0), true); advance(game, 0.15);
  assert.equal(game.projectiles.length, 0); assert.equal(game.inventory.ammo.cannon, 0);
  assert.ok(game.particles.some(p => p.x < 1155 && p.x > 1120));
});

test('Party Cannon movement is frame-rate independent and rotated cars stop a shot', () => {
  const a = makeGame(), b = makeGame();
  for (const game of [a, b]) {
    shop(game); game.purchaseGadget('cannon'); game.buildings = []; game.peds = []; game.police = []; game.cars = [];
    // Aim at chassis height; a lob can now legitimately clear a low car roof.
    game.player.x = game.player.y = 1080; game.action(0, { pitch: 0 });
  }
  a.update(0.25); advance(b, 0.25);
  assert.deepEqual(a.projectiles, b.projectiles);
  a._addCar(1300, 1080, Math.PI / 4, 'van', PAINT_COLORS[0]); advance(a, 0.15);
  assert.equal(a.projectiles.length, 0);
});

test('aiming close-range toys into the sky misses residents and officers without raising heat', () => {
  for (const toy of ['popper', 'hammer']) {
    const game = makeGame(); shop(game);
    if (toy === 'hammer') game.purchaseGadget(toy);
    game.buildings = []; game.cars = []; game.player.x = game.player.y = 1080;
    game.peds = game.peds.slice(0, 1); game.police = game.police.slice(0, 1);
    Object.assign(game.peds[0], { x: 1120, y: 1080, pace: 0 });
    Object.assign(game.police[0], { x: 1120, y: 1080 });
    game.drainEvents();
    assert.equal(game.action(0, { pitch: 1.2 }), true);
    assert.equal(game.physics.bodies.size, 0); assert.equal(game.police[0].distracted, undefined);
    assert.equal(game.heat, 0); assert.ok(game.particles.some(particle => particle.height > 2));
    assert.ok(game.drainEvents().some(event => event.type === 'sound'));
  }
});

test('close-range toys hit along a slightly downward aim and block obstructed shots', () => {
  for (const toy of ['popper', 'hammer']) {
    const game = makeGame(); shop(game);
    if (toy === 'hammer') game.purchaseGadget(toy);
    game.buildings = []; game.cars = []; game.police = []; game.player.x = game.player.y = 1080;
    game.peds = game.peds.slice(0, 2);
    Object.assign(game.peds[0], { x: 1120, y: 1080, pace: 0 });
    Object.assign(game.peds[1], { x: 1120, y: 1090, pace: 0 });
    game.buildings = [{ x: 1100, y: 1083, w: 12, h: 30, height: 4 }];
    assert.equal(game.action(0, { pitch: -0.2 }), true);
    assert.ok(game.physics.get(game.peds[0].id));
    assert.equal(game.physics.get(game.peds[1].id), undefined); assert.equal(game.heat, 0);
    game._updateWitnessReports(2); assert.equal(game.heat, 1);
  }
});

test('aimed Party Cannon follows vertical pitch, hits at body height, and leaves sky bursts harmless', () => {
  const makeShot = pitch => {
    const game = makeGame(); shop(game); game.purchaseGadget('cannon');
    // Use an open road; the town centre now contains a solid fountain.
    game.buildings = []; game.cars = []; game.police = []; game.player.x = 1080; game.player.y = 900;
    game.peds = game.peds.slice(0, 1); Object.assign(game.peds[0], { x: 1230, y: 900, pace: 0 });
    assert.equal(game.action(0, { pitch }), true); return game;
  };
  const sky = makeShot(1.1), level = makeShot(0);
  advance(sky, 0.1); advance(level, 0.1);
  assert.ok(sky.projectiles[0].height > 4); assert.ok(sky.projectiles[0].x < level.projectiles[0].x);
  assert.equal(sky.projectiles[0].verticalSpeed > 0, true); assert.equal(level.projectiles[0].verticalSpeed, 0);
  advance(sky, 0.7); advance(level, 0.35);
  assert.equal(sky.projectiles.length, 0); assert.equal(sky.physics.bodies.size, 0); assert.equal(sky.heat, 0);
  assert.ok(sky.particles.some(particle => particle.height > 10));
  assert.equal(level.projectiles.length, 0); assert.ok(level.physics.get(level.peds[0].id)); assert.equal(level.heat, 0);
  level._updateWitnessReports(2); assert.equal(level.heat, 1);
  const ground = makeShot(-0.4); advance(ground, 0.1);
  assert.equal(ground.projectiles.length, 0); assert.ok(ground.particles.some(particle => particle.height === 0.12));
});

test('aimed cannon passes above short obstacles and bounds extreme or invalid pitch', () => {
  const game = makeGame(); shop(game); game.purchaseGadget('cannon');
  game.cars = []; game.police = []; game.peds = []; game.player.x = game.player.y = 1080;
  game.buildings = [{ x: 1160, y: 1060, w: 20, h: 40, height: 2 }];
  game.action(0, { pitch: 0.7 }); advance(game, 0.2);
  assert.equal(game.projectiles.length, 1); assert.ok(game.projectiles[0].x > 1180);
  assert.ok(game.projectiles[0].height > 5);
  game._actionCooldown = 0; game.action(0, { pitch: 100 });
  assert.equal(game.player.aimPitch, 1.35); assert.ok(Number.isFinite(game.projectiles[1].verticalSpeed));
  game._actionCooldown = 0; game.action(0, { pitch: NaN });
  assert.equal(game.projectiles[2].aimed, undefined); assert.equal(game.projectiles[2].height, MUZZLE_HEIGHT);
});

test('garage ownership persists condition and paint without duplicating or healing deployed cars', () => {
  const game = makeGame(), car = driveToGarage(game); game.money = 500;
  game.heat = 1;
  car.health = 72; assert.equal(game.garageStore(), true); const id = car.garageId;
  assert.equal(game.garageStore(), false); assert.equal(game.garage.cars.length, 1);
  assert.equal(game.garagePaint(id, PAINT_COLORS[1]), true); assert.equal(game.money, 475);
  assert.equal(car.color, PAINT_COLORS[1]); assert.equal(game.garagePaint(id, PAINT_COLORS[1]), false);
  assert.equal(game.garagePaint(id, '#ffffff'), false); assert.equal(game.money, 475);
  car.health = 21;
  const count = game.cars.length;
  assert.equal(game.garageRetrieve(id), true); assert.equal(game.current, car); assert.equal(game.cars.length, count);
  assert.equal(car.health, 21); assert.equal(game.garage.cars[0].health, 21); assert.equal(game.heat, 1);
  assert.ok(game._vehicleFree(car)); assert.ok(!game._vehicles().some(other => other !== car && game._vehicleContact(car, other)));
  const saved = game.exportSave(), reloaded = makeGame(); reloaded.loadSave(saved); shop(reloaded);
  assert.equal(reloaded.garageRetrieve(id), true); assert.equal(reloaded.current.health, 21); assert.equal(reloaded.current.color, PAINT_COLORS[1]);
  assert.equal(reloaded.heat, 0); assert.equal(reloaded.current.borrowed, true);
  assert.equal(reloaded.usePocket('repairTape'), true); assert.equal(reloaded.current.health, 76);
  assert.equal(reloaded.exportSave().garage.cars[0].health, 76);
});

test('garage has three slots and a blocked exit does not create or move a ride', () => {
  const game = makeGame(), car = driveToGarage(game);
  game.garageStore(); const id = car.garageId;
  game.garage.cars.push({ id: 'ride-2', kind: 'van', color: PAINT_COLORS[2], health: 50 }, { id: 'ride-3', kind: 'sports', color: PAINT_COLORS[3], health: 100 });
  const other = game._addCar(900, 900, 0, 'sports', PAINT_COLORS[3]); game.player.vehicleId = other.id;
  assert.equal(game.garageStore(), false); assert.equal(game.garage.cars.length, 3);
  game.buildings.push({ x: 750, y: 750, w: 300, h: 300 });
  const before = game.cars.map(value => ({ ...value }));
  assert.equal(game.garageRetrieve(id), false); assert.deepEqual(game.cars, before);
});

test('collection repair rescues stored and deployed wrecks without retrieval healing or wasted cash', () => {
  const game = makeGame(), car = driveToGarage(game); game.money = 100;
  assert.equal(game.garageStore(), true); const id = car.garageId;
  car.health = 0;
  const saved = game.exportSave(); assert.equal(saved.garage.cars[0].health, 0);
  assert.equal(game.garageRetrieve(id), false); assert.equal(car.health, 0); assert.equal(game.money, 100);
  assert.equal(game.garageRepair(id), true); assert.equal(game.money, 55); assert.equal(car.health, 100);
  assert.equal(game.garageRepair(id), false); assert.equal(game.money, 55);
  assert.equal(game.garageRetrieve(id), true); assert.equal(game.current, car); assert.equal(game.exportSave().garage.cars[0].health, 100);
  const copy = makeGame(); copy.loadSave(saved); copy.money = 44;
  assert.equal(copy.garageRepair(id), false); assert.equal(copy.money, 44);
  copy.player.x = 900; copy.player.y = 900;
  assert.equal(copy.garageRetrieve(id), false); assert.equal(copy.garageRepair(id), false); assert.equal(copy.money, 44);
  copy.money = 45; assert.equal(copy.garageRepair('unknown'), false); assert.equal(copy.money, 45);
  assert.equal(copy.garageRepair(id), true); assert.equal(copy.money, 0); assert.equal(copy.garage.cars[0].health, 100);
  assert.equal(copy.garageRetrieve(id), true); assert.equal(copy.current.health, 100);
  const restored = makeGame(); restored.loadSave(copy.exportSave()); assert.equal(restored.garage.cars[0].health, 100);
});

test('releasing a collected ride preserves world state and allows replacing a full garage slot', () => {
  const game = makeGame(), released = driveToGarage(game); released.health = 44;
  assert.equal(game.garageStore(), true); const id = released.garageId;
  for (const [kind, color] of [['van', PAINT_COLORS[1]], ['sports', PAINT_COLORS[2]]]) {
    const car = game._addCar(900, 900, 0, kind, color); game.player.vehicleId = car.id;
    assert.equal(game.garageStore(), true);
  }
  const replacement = game._addCar(900, 900, 0, 'van', PAINT_COLORS[3]); game.player.vehicleId = replacement.id;
  assert.equal(game.garageStore(), false); assert.equal(game.garage.cars.length, 3);
  const cash = game.money, count = game.cars.length;
  replacement.x = 1260;
  const before = game.exportSave(); assert.equal(game.garageRelease(id), false); assert.deepEqual(game.exportSave(), before);
  replacement.x = 900;
  assert.equal(game.garageRelease('unknown'), false); assert.equal(game.garage.cars.length, 3);
  assert.equal(game.garageRelease(id), true); assert.equal(game.current, replacement); assert.equal(game.money, cash);
  assert.equal(game.cars.length, count); assert.equal(released.health, 44); assert.equal(released.color, PAINT_COLORS[0]); assert.equal(released.garageId, undefined);
  assert.equal(game.exportSave().garage.cars.some(record => record.id === id), false);
  assert.equal(game.garageStore(), true); assert.equal(game.garage.cars.length, 3);
  assert.ok(game.exportSave().garage.cars.some(record => record.kind === 'van' && record.color === PAINT_COLORS[3]));
});

test('legacy progress migrates with starter inventory and armor loading is idempotent', () => {
  const game = makeGame();
  const old = { version: 1, money: 777, score: 80, bestScore: 123, completed: 9, upgrades: { boost: 2, armor: 2 } };
  assert.equal(game.loadSave(old), true); assert.equal(game.money, 777); assert.equal(game.completed, 9);
  assert.equal(game.current, game.player); assert.deepEqual(game.inventory.pockets, { biscuits: 2, repairTape: 1, refill: 1 });
  assert.equal(game.cars[0].health, 150); game.cars[0].health = 93;
  assert.equal(game.loadSave(old), true); assert.equal(game.cars[0].health, 93);
  assert.equal(game.exportSave().version, 2); assert.deepEqual(game.garage.cars, []);
});

test('new saves validate hostile IDs, stacks, ammo, paint, car capacity, and omit transient state', () => {
  const game = makeGame();
  assert.equal(game.loadSave({ version: 2, inventory: {
    equipped: 'constructor', unlocked: ['popper', 'cannon', 'cannon', 'hammer', '__proto__'],
    pockets: { biscuits: 100, repairTape: -3, refill: Infinity }, ammo: { cannon: 900 }
  }, garage: { cars: [
    { id: 'ride-1', kind: 'compact', color: PAINT_COLORS[0], health: 1e100 },
    { id: 'ride-1', kind: 'van', color: PAINT_COLORS[1], health: 50 },
    { id: '__proto__', kind: 'van', color: PAINT_COLORS[1], health: 50 },
    { id: 'ride-2', kind: 'constructor', color: PAINT_COLORS[1], health: 50 },
    { id: 'ride-2', kind: 'van', color: '#ffffff', health: 50 },
    { id: 'ride-2', kind: 'van', color: PAINT_COLORS[1], health: -30 },
    { id: 'ride-3', kind: 'sports', color: PAINT_COLORS[2], health: NaN },
    { id: 'ride-4', kind: 'compact', color: PAINT_COLORS[0], health: 50 }
  ] } }), true);
  assert.deepEqual(game.inventory.unlocked, ['popper', 'cannon', 'hammer']); assert.equal(game.inventory.equipped, 'popper');
  assert.deepEqual(game.inventory.pockets, { biscuits: 5, repairTape: 0, refill: 1 }); assert.equal(game.inventory.ammo.cannon, 12);
  assert.deepEqual(game.garage.cars.map(car => [car.id, car.health]), [['ride-1', 100], ['ride-2', 0], ['ride-3', 0]]);
  game.equipGadget('cannon'); game.player.x = 1080; game.action(0); game.flop();
  const saved = game.exportSave(), copy = makeGame(); assert.equal(copy.loadSave(saved), true);
  assert.deepEqual(copy.exportSave(), saved); assert.equal(copy.projectiles.length, 0); assert.equal(copy.physics.bodies.size, 0);
  saved.inventory.unlocked.push('evil'); saved.garage.cars[0].health = 0;
  assert.equal(game.inventory.unlocked.includes('evil'), false); assert.equal(game.garage.cars[0].health, 100);
});

test('armor upgrades carry condition gains to stored and deployed owned rides once', () => {
  const game = makeGame(), car = driveToGarage(game); game.money = 3000;
  car.health = 40; game.garageStore();
  game.garage.cars.push({ id: 'ride-2', kind: 'van', color: PAINT_COLORS[2], health: 60 });
  assert.equal(game.purchase('armor'), true); assert.equal(car.health, 65);
  assert.deepEqual(game.garage.cars.map(record => record.health), [65, 85]);
  const saved = game.exportSave(); game.loadSave(saved); game.loadSave(saved);
  assert.equal(car.health, 65); assert.deepEqual(game.garage.cars.map(record => record.health), [65, 85]);
});
