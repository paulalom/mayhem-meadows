'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, MAX_HEAT, GARAGE_SERVICE_TIMING } = require('../core.js');
const { makeFlatGame } = require('./helpers/flat-game.cjs');

function fixture() {
  const game = makeFlatGame();
  game.cars = []; game.peds = []; game.buildings = []; game.staticObjects = []; game.police = [];
  Object.assign(game.player, { x: 900, y: 900, elevation: 0, angle: 0 });
  game.graceTimer = 0; game.vehiclePhysics.sync();
  return game;
}
function patrol(game, x, y = 900) {
  const cop = { id: `tier-patrol-${game.police.length}`, ...game._vehicleState('compact'), x, y, elevation: 0,
    angle: 0, speed: 0, route: [{ x: 900, y }], routeTimer: 999, lastSeen: { x: 900, y: 900 } };
  game.police.push(cop); return cop;
}

test('observed toy incidents reach the fourth star and cannot exceed it', () => {
  const game = fixture(), cop = patrol(game, 990);
  assert.equal(MAX_HEAT, 4); assert.equal(Game.MAX_HEAT, MAX_HEAT);
  // Each action is a separate reportable incident after the normal cooldown.
  // The actual popper hit and officer report path must earn the new star.
  for (let incident = 1; incident <= 5; incident++) {
    game._actionCooldown = game._troubleCooldown = 0;
    cop.distracted = 0;
    assert.equal(game.action(0), true);
    assert.equal(game.heat, Math.min(incident, MAX_HEAT));
    assert.ok(cop.distracted > 0);
  }
  const heatSounds = game.drainEvents().filter(event => event.type === 'sound' && event.name === 'heat');
  assert.deepEqual(heatSounds.map(event => event.details.level), [1, 2, 3, 4]);
});

test('the fourth star keeps civilian patrol count, sight and speed at third-star strength', () => {
  const results = [];
  for (const heat of [3, 4]) {
    const game = fixture(), controls = [];
    game.heat = heat;
    patrol(game, 350); patrol(game, 350, 1260); patrol(game, 350, 1620);
    game.vehiclePhysics.control = (cop, control) => controls.push(control.targetSpeed);
    game._updatePolice(1 / 60);
    results.push({ count: game.police.filter(cop => game._activePolice(cop)).length, seen: game.policeSeen, controls });
  }
  assert.deepEqual(results[1], results[0]);
  assert.equal(results[1].count, 3); assert.equal(results[1].seen, false);
  assert.equal(results[1].controls[0], 235);
});

test('confirmed military sight prevents cooling, and a hidden fourth-star player escapes after 32 seconds', () => {
  const game = fixture();
  game.heat = MAX_HEAT; game.escapeTimer = 12;
  for (let index = 0; index < 3; index++) patrol(game, 7000, 3000 + index * 400);
  game.airPoliceSeen = true;
  game._updatePolice(1 / 60);
  assert.equal(game.policeSeen, true); assert.equal(game.escapeTimer, 0); assert.equal(game.escapeGoal, 32);
  game.airPoliceSeen = false;
  game._updatePolice(31.99);
  assert.equal(game.heat, MAX_HEAT); assert.equal(game.policeSeen, false);
  game._updatePolice(.02);
  assert.equal(game.heat, 0); assert.equal(game.escapeTimer, 0); assert.equal(game.airPoliceSeen, false);
  assert.ok(game.drainEvents().some(event => event.type === 'sound' && event.name === 'escape'));
});

test('garage service and capture clear fourth-star heat, pending calls and stale aircraft sight', () => {
  for (const ending of ['repair', 'capture']) {
    const game = fixture(), reporter = { bubble: 'HELP! CALLING POLICE...', bubbleTimer: 2 };
    game.heat = MAX_HEAT; game.airPoliceSeen = game.policeSeen = true; game.escapeTimer = 17;
    game._witnessReports.push({ reporter, remaining: 2 });
    if (ending === 'repair') {
      const service = game.services.find(value => value.id === 'repair');
      const car = game._addCar(service.x, service.y, 0, 'compact', '#ffd15b'); game.player.vehicleId = car.id;
      assert.equal(game._useService(service), true);
      for (let tick = 0; tick < Math.ceil((GARAGE_SERVICE_TIMING.blackAt + .01) * 60); tick++) game.update(1 / 60);
    }
    else game._caught();
    assert.equal(game.heat, 0); assert.equal(game.airPoliceSeen, false); assert.equal(game.policeSeen, false);
    assert.equal(game.escapeTimer, 0); assert.equal(game._witnessReports.length, 0); assert.equal(reporter.bubble, '');
  }
});

test('paused simulation frames preserve fourth-star cooling and warning clocks', () => {
  const game = fixture();
  game.heat = MAX_HEAT; game.escapeTimer = 7;
  const before = { time: game.time, escape: game.escapeTimer, warning: game.aviation.militaryWarning };
  for (const dt of [0, -1, NaN]) game.update(dt);
  assert.deepEqual({ time: game.time, escape: game.escapeTimer, warning: game.aviation.militaryWarning }, before);
  assert.equal(game.heat, MAX_HEAT);
});

test('heat display level is an integer bounded to four stars for all exposed values', () => {
  const game = fixture();
  for (const [heat, level] of [[0, 0], [1, 1], [3, 3], [4, 4], [99, 4], [-3, 0], [4.9, 4], [NaN, 0], [Infinity, 0], ['4', 0]]) {
    game.heat = heat;
    assert.equal(game.heatLevel, level);
    assert.equal(('★'.repeat(game.heatLevel) + '☆'.repeat(MAX_HEAT - game.heatLevel)).length, MAX_HEAT);
  }
});
