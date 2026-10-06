'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../core.js');
const World = require('../world.js');
const { MUZZLE_HEIGHT, PLAYER_RADIUS } = require('../physics.js');

const empty = () => {
  const game = new Game({ seed: 42 });
  game.cars = []; game.police = []; game.peds = []; game.buildings = []; game.staticObjects = [];
  Object.assign(game.player, { x: 900, y: 900, angle: 0 });
  game.graceTimer = 0; game.vehiclePhysics.sync(); return game;
};
const prop = (kind = 'fence', x = 940, y = 900) => ({
  id: 'test-' + kind, kind, x, y, angle: 0, destructible: kind !== 'garage',
  health: World.PROP_HEALTH[kind] || 45, maxHealth: World.PROP_HEALTH[kind] || 45,
  parts: [{ shape: 'box', offset: [0, .5, 0], half: [.2, .5, .6] }]
});
const install = (game, objects) => { game.staticObjects = objects; game.vehiclePhysics.sync(); };
const advance = (game, seconds, input = {}) => {
  for (let t = 0; t < seconds - .00001; t += 1 / 60) game.update(1 / 60, input);
};

test('all outdoor physical scenery has durability, while buildings and the garage kiosk remain intact', () => {
  const game = new Game({ seed: 42 }), buildings = JSON.stringify(game.buildings), services = JSON.stringify(game.services);
  const kinds = new Set();
  for (const object of game.staticObjects) {
    if (object.kind === 'garage') {
      assert.equal(object.destructible, false);
      assert.equal(game._damageProp(object, 10000), false);
      assert.equal(object.destroyed, undefined);
    } else {
      kinds.add(object.kind); assert.equal(object.destructible, true); assert.ok(object.health > 0);
      assert.equal(game._damageProp(object, object.health, game.player), true);
      assert.equal(object.destroyed, true); assert.equal(object.health, 0);
    }
  }
  for (const kind of ['tree', 'fence', 'lamp', 'bench', 'fountain', 'wash', 'wayfinding']) assert.ok(kinds.has(kind));
  assert.equal(game._damageProp(game.buildings[0], 10000), false);
  assert.equal(JSON.stringify(game.buildings), buildings); assert.equal(JSON.stringify(game.services), services);
});

test('destroying a prop clears cached foot contacts, Cannon bodies, support, raycasts and ragdoll contacts immediately', () => {
  const game = empty(), bench = prop('bench', 900); install(game, [bench]);
  assert.equal(game._isFree(900, 900, PLAYER_RADIUS), false);
  assert.ok(game.vehiclePhysics.support(900, 900, 2) > .9);
  assert.ok(game.ragdolls._colliders({ staticObjects: game.staticObjects }).length > 0);
  assert.ok(game.vehiclePhysics.hitsSegment({ x: 880, y: 900, height: .5 }, { x: 920, y: 900, height: .5 }));
  const version = game._environmentVersion;
  game._damageProp(bench, 100, game.player);
  assert.equal(game._environmentVersion, version + 1);
  assert.equal(game._isFree(900, 900, PLAYER_RADIUS), true);
  assert.equal(game.vehiclePhysics.support(900, 900, 2), 0);
  assert.equal(game.vehiclePhysics.world.bodies.some(body => body.source === bench), false);
  assert.equal(game.vehiclePhysics.hitsSegment({ x: 880, y: 900, height: .5 }, { x: 920, y: 900, height: .5 }), false);
  assert.equal(game.ragdolls._colliders({ staticObjects: game.staticObjects }).length, 0);
  const debris = game.debris.length;
  assert.equal(game._damageProp(bench, 100), false);
  assert.equal(game._environmentVersion, version + 1); assert.equal(game.debris.length, debris);
});

test('popper chips scenery with its normal cooldown and hammer destroys a nearby fence', () => {
  const game = empty(), fence = prop(); install(game, [fence]);
  assert.equal(game.action(0), true); assert.equal(fence.health, 15);
  assert.equal(game.action(0), false); assert.equal(fence.health, 15);
  advance(game, .6); assert.equal(game.action(0), true); assert.equal(fence.health, 5);
  advance(game, .6); game.inventory.unlocked.push('hammer'); game.inventory.equipped = 'hammer';
  assert.equal(game.action(0), true); assert.equal(fence.destroyed, true); assert.ok(game.heat > 0);
});

test('strikes respect facing, pitch and walls, and can reach the near edge of a long rotated fence', () => {
  for (const blockedBy of ['behind', 'wall', 'pitch', 'other-prop']) {
    const game = empty(), fence = prop('fence', blockedBy === 'behind' ? 860 : 940);
    install(game, blockedBy === 'other-prop' ? [prop('garage', 920), fence] : [fence]);
    if (blockedBy === 'wall') {
      game.buildings = [{ x: 917, y: 870, w: 8, h: 60, height: 5 }]; game.vehiclePhysics.sync();
    }
    game.inventory.equipped = 'hammer'; game.action(0, { pitch: blockedBy === 'pitch' ? 1 : 0 });
    assert.equal(fence.health, 25, blockedBy);
  }
  const game = empty(), fence = prop('fence', 900, 1020);
  fence.angle = Math.PI / 2; fence.parts[0].half = [6, .5, .175];
  game.player.x = 870; install(game, [fence]); game.inventory.equipped = 'hammer';
  game.action(0); assert.equal(fence.destroyed, true, 'surface distance works even when the centre is out of reach');
});

test('cannon bursts damage scenery in three dimensions, with walls shielding props', () => {
  for (const blockedBy of ['none', 'height', 'wall']) {
    const game = empty(), tree = prop('tree', 940); install(game, [tree]);
    if (blockedBy === 'wall') {
      game.buildings = [{ x: 917, y: 870, w: 8, h: 60, height: 6 }]; game.vehiclePhysics.sync();
    }
    game._burstParty({ x: 900, y: 900, height: blockedBy === 'height' ? 9 : MUZZLE_HEIGHT, aimed: true, angle: 0 });
    assert.equal(Boolean(tree.destroyed), blockedBy === 'none', blockedBy);
  }
  const game = empty(), tree = prop('tree', 1000);
  tree.parts[0].half[1] = 2; tree.parts[0].offset[1] = 2; install(game, [tree]);
  game.inventory.equipped = 'cannon'; game.inventory.ammo.cannon = 1; game.action(0, { pitch: 0 });
  advance(game, .4);
  assert.equal(tree.destroyed, true); assert.equal(game.projectiles.length, 0); assert.equal(game.inventory.ammo.cannon, 0);
});

test('aimed upward strikes hit the elevated surface of tall props', () => {
  const game = empty(), lamp = prop('lamp');
  lamp.parts[0] = { offset: [0, 1.4, 0], half: [.2, 1.4, .2] }; install(game, [lamp]);
  game.inventory.equipped = 'hammer'; game.action(0, { pitch: .45 });
  assert.equal(lamp.destroyed, true);
});

test('cannon collateral is independent of prop order when the burst starts inside its target', () => {
  for (const reversed of [false, true]) {
    const game = empty(), source = prop('tree', 900), neighbor = prop('tree', 940);
    install(game, reversed ? [neighbor, source] : [source, neighbor]);
    game._burstParty({ x: 900, y: 900, height: .5, aimed: true, angle: 0 });
    assert.equal(source.destroyed, true); assert.equal(neighbor.destroyed, true);
  }
});

test('fast real vehicle contacts smash props, gentle bumps and height-separated passes do not', () => {
  for (const [speed, elevation, destroyed] of [[240, 0, true], [55, 0, false], [240, 5, false]]) {
    const game = empty(), lamp = prop('lamp', 1010); lamp.parts[0] = { shape: 'cylinder', offset: [0, 1.4, 0], half: [.07, 1.4, .07] };
    install(game, [lamp]);
    const car = game._addCar(900, 900, 0, 'compact', '#ffd15b');
    Object.assign(car, { speed, vx: speed, elevation });
    game.player.vehicleId = car.id; advance(game, .55, { up: speed > 100 });
    assert.equal(Boolean(lamp.destroyed), destroyed, `${speed}, ${elevation}`);
  }
});

test('traffic destruction does not blame the player and vehicle explosions damage nearby scenery', () => {
  const game = empty(), fence = prop(); install(game, [fence]);
  game._damageProp(fence, 100, { x: 900, y: 900 }, false); assert.equal(game.heat, 0);
  const tree = prop('tree', 1040); install(game, [tree]);
  const car = game._addCar(1000, 900, 0, 'compact', '#ffd15b');
  Object.assign(car, { exploded: true, explosionTime: game.time });
  game.vehiclePhysics.sync(); game._propExplosions(); assert.equal(tree.destroyed, true);
  const debris = game.debris.length; game._propExplosions(); assert.equal(game.debris.length, debris);
});

test('debris is bounded, pauses with the world, settles, expires, and destruction resets on a new game', () => {
  const game = empty();
  const objects = Array.from({ length: 50 }, (_, i) => prop('tree', 940 + i * 10)); install(game, objects);
  for (const object of objects) game._damageProp(object, 100, game.player, false);
  assert.equal(game.debris.length, 120);
  const before = JSON.stringify(game.debris); game.update(0); game.update(NaN); assert.equal(JSON.stringify(game.debris), before);
  advance(game, 2);
  assert.ok(game.debris.every(piece => piece.elevation >= piece.size[1] / 2 && Number.isFinite(piece.x)));
  advance(game, 3); assert.equal(game.debris.length, 0);
  const saved = game.exportSave(); assert.equal('debris' in saved, false); assert.equal('staticObjects' in saved, false);
  const fresh = new Game({ seed: 42 }); fresh.loadSave(saved);
  assert.ok(fresh.staticObjects.every(object => !object.destroyed));
});
