'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { GARAGE_SERVICE_TIMING } = require('../core.js');
const { makeFlatGame } = require('./helpers/flat-game.cjs');
const World = require('../world.js');
const advance = (game, seconds) => { for (let t = 0; t < seconds - .000001; t += 1 / 60) game.update(1 / 60); };
function empty() {
  const game = makeFlatGame();
  game.cars = []; game.police = []; game.peds = []; game.buildings = []; game.staticObjects = [];
  Object.assign(game.player, { x: 900, y: 900, elevation: 0, angle: 0 });
  game.graceTimer = 0; game.vehiclePhysics.sync(); return game;
}
function cop(game, x = 1100, y = 900, extra = {}) {
  const value = { id: 'cop-' + game.police.length, ...game._vehicleState('compact'), x, y, elevation: 0, angle: 0, speed: 0,
    route: [{ x, y }], routeTimer: 999, ...extra };
  game.police.push(value); return value;
}
function resident(game, x = 940, y = 900, extra = {}) {
  const value = { id: 'resident-' + game.peds.length, x, y, elevation: 0, homeX: x, homeY: y, angle: 0, pace: 0,
    stunned: 0, bubble: '', bubbleTimer: 0, ...extra };
  game.peds.push(value); return value;
}
function fence(game, x = 940) {
  const value = { id: 'fence', kind: 'fence', x, y: 900, elevation: 0, health: World.PROP_HEALTH.fence,
    parts: [{ shape: 'box', offset: [0, .5, 0], half: [.2, .5, .6] }] };
  game.staticObjects.push(value); game.vehiclePhysics.sync(); return value;
}

test('unwitnessed theft, scenery damage, traffic crashes and party stops add no heat or search reset', () => {
  for (const action of ['theft', 'scenery', 'crash', 'party']) {
    const game = empty(), patrol = cop(game, 2000, 900);
    patrol.lastSeen = { x: 800, y: 800 }; game.heat = 1; game.escapeTimer = 5;
    const car = game._addCar(900, 900, 0, 'compact', '#ffd15b');
    if (action === 'theft') game.interact();
    if (action === 'scenery') game._damageProp(fence(game), 100, game.player);
    if (action === 'crash') { game.player.vehicleId = car.id; game._impact(car, 200, true); }
    if (action === 'party') {
      game.player.vehicleId = car.id; game.acceptMission('party');
      Object.assign(car, game.mission.targets[0]); game.horn();
      assert.equal(game.mission.targetIndex, 1);
    }
    assert.equal(game.heat, 1, action); assert.equal(game.escapeTimer, 5, action);
    assert.equal(game._witnessReports.length, 0, action); assert.deepEqual(patrol.lastSeen, { x: 800, y: 800 }, action);
    assert.equal(game.drainEvents().some(event => event.name === 'heat'), false, action);
  }
});

test('police see theft within range; walls, distance and disabled patrols prevent detection', () => {
  for (const scenario of ['visible', 'wall', 'far', 'wrecked', 'burning', 'exploded', 'distracted', 'high']) {
    const game = empty(), patrol = cop(game);
    if (scenario === 'wall') game.buildings = [{ x: 990, y: 870, w: 20, h: 60, height: 5 }];
    if (scenario === 'far') patrol.x = 1400;
    if (scenario === 'wrecked') patrol.health = 0;
    if (scenario === 'burning') patrol.burning = true;
    if (scenario === 'exploded') patrol.exploded = true;
    if (scenario === 'distracted') patrol.distracted = 5;
    if (scenario === 'high') patrol.elevation = 30;
    game._addCar(900, 900, 0, 'compact', '#ffd15b'); game.interact();
    assert.equal(game.heat, scenario === 'visible' ? 1 : 0, scenario);
  }
});

test('police can hear a nearby crash through a wall, with reduced range and no distant hearing', () => {
  for (const [x, expected] of [[965, 1], [1100, 0], [1400, 0]]) {
    const game = empty(); cop(game, x);
    game.buildings = [{ x: 930, y: 870, w: 15, h: 60, height: 5 }];
    const car = game._addCar(900, 900, 0, 'compact', '#ffd15b'); game.player.vehicleId = car.id;
    game._impact(car, 200, true); assert.equal(game.heat, expected, 'cop x=' + x);
  }
});

test('a terrain ridge blocks police and resident sight and muffles incident noise', () => {
  for (const observer of ['police', 'resident']) {
    const game = empty();
    game.world.terrain = { surfaceHeight: x => x >= 975 && x <= 1025 ? 6 : 0 };
    if (observer === 'police') cop(game, 1100); else resident(game, 1080);
    game._raiseHeat(1, 'Hidden behind the ridge', { position: game.player, noise: 220 });
    assert.equal(game.heat, 0, observer); assert.equal(game._witnessReports.length, 0, observer);
  }
});

test('a civilian help call takes two seconds and reports the original location after the player leaves', () => {
  const game = empty(), witness = resident(game, 1000), patrol = cop(game, 2000);
  game._addCar(900, 900, 0, 'compact', '#ffd15b'); game.interact();
  assert.equal(game.heat, 0); assert.match(witness.bubble, /HELP! CALLING POLICE/);
  game.interact(); Object.assign(game.player, { x: 1500, y: 1500 });
  advance(game, 1.9); assert.equal(game.heat, 0);
  advance(game, .1); assert.equal(game.heat, 1);
  assert.deepEqual(patrol.lastSeen, { x: 900, y: 900 });
  assert.ok(game.drainEvents().some(event => event.type === 'toast' && /resident called for help/.test(event.text)));
});

test('civilian witnesses need sight and range, while a toy victim can call during their tumble', () => {
  for (const scenario of ['wall', 'far', 'stunned']) {
    const game = empty(), witness = resident(game, scenario === 'far' ? 1200 : 1000);
    if (scenario === 'wall') game.buildings = [{ x: 950, y: 870, w: 20, h: 60, height: 5 }];
    if (scenario === 'stunned') witness.stunned = 3;
    game._addCar(900, 900, 0, 'compact', '#ffd15b'); game.interact();
    assert.equal(game._witnessReports.length, 0, scenario); assert.equal(game.heat, 0, scenario);
  }
  const game = empty(), victim = resident(game); cop(game, 2000);
  game.action(0); assert.ok(game.ragdolls.get(victim.id)); assert.equal(game.heat, 0);
  advance(game, 2); assert.equal(game.heat, 1); assert.ok(game.ragdolls.get(victim.id));
});

test('hitting an officer still reports immediately after the toy distracts them', () => {
  for (const toy of ['popper', 'hammer', 'cannon']) {
    const game = empty(), patrol = cop(game, 940);
    game.inventory.equipped = toy;
    if (toy === 'cannon') game._burstParty({ x: 940, y: 900, height: 1, angle: 0 }); else game.action(0);
    if (toy === 'hammer') { assert.equal(game.heat, 0, 'winding up is harmless'); advance(game, .23); }
    assert.ok(patrol.distracted > 0, toy); assert.equal(game.heat, 1, toy);
    assert.equal(game._witnessReports.length, 0, toy);
  }
});

test('remote cannon hits use witnesses at the burst instead of the shooter', () => {
  const game = empty(); cop(game, 2000); resident(game, 900);
  game._burstParty({ x: 1800, y: 900, height: 1, angle: 0 });
  assert.equal(game.heat, 0); assert.equal(game._witnessReports.length, 0);
  const victim = resident(game, 1800);
  game._burstParty({ x: 1800, y: 900, height: 1, angle: 0 });
  assert.equal(game.heat, 1); assert.ok(game.ragdolls.get(victim.id));
  assert.deepEqual(game.police[0].lastSeen, { x: 1800, y: 900 });
});

test('confirmed incidents reset search at the heat cap and during cooldown; unseen incidents do not', () => {
  const game = empty(); cop(game, 1100); const prop = fence(game);
  game.heat = 4; game.escapeTimer = 5; game._troubleCooldown = 2;
  game._damageProp(prop, 100, game.player);
  assert.equal(game.heat, 4); assert.equal(game.escapeTimer, 0);
  assert.deepEqual(game.police[0].lastSeen, { x: prop.x, y: prop.y });
  game.police[0].x = 2000; game.escapeTimer = 5;
  game._raiseHeat(1, 'Hidden mischief'); assert.equal(game.escapeTimer, 5);
});

test('garage service, capture and escape clear pending calls so they cannot restart a chase', () => {
  for (const ending of ['repair', 'capture', 'escape']) {
    const game = empty(), witness = resident(game);
    game._addCar(900, 900, 0, 'compact', '#ffd15b'); game.interact();
    assert.equal(game._witnessReports.length, 1);
    if (ending === 'repair') {
      const service = game.services.find(value => value.id === 'repair');
      Object.assign(game.current, { x: service.x, y: service.y });
      game.money = 100; assert.equal(game._useService(service), true);
      advance(game, GARAGE_SERVICE_TIMING.blackAt + .01);
    }
    if (ending === 'capture') game._caught();
    if (ending === 'escape') {
      game.heat = 1; game.escapeTimer = game.escapeGoal; cop(game, 2000); game._updatePolice(1 / 60);
    }
    assert.equal(game._witnessReports.length, 0, ending); assert.equal(witness.bubble, '', ending);
    game._updateWitnessReports(3); assert.equal(game.heat, 0, ending);
  }
});

test('missed toys, ordinary horns and voluntary flops stay harmless in front of police', () => {
  for (const action of ['toy', 'horn', 'flop']) {
    const game = empty(); cop(game, 1100);
    if (action === 'toy') game.action(0);
    if (action === 'horn') { const car = game._addCar(900, 900, 0, 'compact', '#ffd15b'); game.player.vehicleId = car.id; game.horn(); }
    if (action === 'flop') game.flop();
    assert.equal(game.heat, 0, action); assert.equal(game._witnessReports.length, 0, action);
  }
});
