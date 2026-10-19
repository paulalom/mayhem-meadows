'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CAR_TYPES } = require('../core.js');
const Aircraft = require('../aircraft.js');
const { makeFlatGame } = require('./helpers/flat-game.cjs');

function fixture() {
  const game = makeFlatGame();
  game.cars = []; game.police = []; game.peds = []; game.buildings = []; game.staticObjects = [];
  Object.assign(game.player, { x: 900, y: 900, elevation: 0, angle: 0, vehicleId: null });
  game.inventory.unlocked.push('hammer'); game.inventory.equipped = 'hammer';
  game.graceTimer = 0; game.vehiclePhysics.sync(); game.drainEvents();
  return game;
}
function resident(game, x = 940, extra = {}) {
  const person = { id: 'hammer-target', x, y: 900, elevation: 0, angle: 0, homeX: x, homeY: 900,
    pace: 0, stunned: 0, bubble: '', bubbleTimer: 0, ...extra };
  game.peds.push(person); return person;
}
function advance(game, seconds) {
  for (let remaining = seconds; remaining > 1e-8; remaining -= 1 / 60) game.update(Math.min(1 / 60, remaining));
}
const bonks = game => game.drainEvents().filter(event => event.type === 'sound' && event.name === 'hammer');
function ride(game, kind = 'compact', extra = {}) {
  // Put each near bumper forty map units from the player, so chassis length
  // does not make heavier vehicles easier or harder to hit in the mass test.
  const car = game._addCar(940 + CAR_TYPES[kind].length / 2, 900, 0, kind, '#ffd15b');
  Object.assign(car, { traffic: false, ...extra }); game.vehiclePhysics.sync(); return car;
}

test('hammer winds up before its single contact and emits confetti and a bonk only on impact', () => {
  const game = fixture(), person = resident(game);
  assert.equal(game.action(0), true); assert.equal(game._actionCooldown, .9);
  assert.equal(game.ragdolls.get(person.id), undefined); assert.equal(game.particles.length, 0); assert.equal(bonks(game).length, 0);
  game.update(.2);
  assert.equal(game.ragdolls.get(person.id), undefined); assert.equal(game.particles.length, 0); assert.equal(bonks(game).length, 0);
  game.update(.02);
  const impacts = bonks(game);
  assert.ok(game.ragdolls.get(person.id)); assert.ok(game.particles.length > 0); assert.equal(impacts.length, 1);
  assert.ok(game.particles.every(particle => Math.hypot(particle.x - impacts[0].details.x, particle.y - impacts[0].details.y) < 1),
    'confetti originates at the actual target contact');
  assert.equal(game.action(0), false, 'the follow-through retains the distinct hammer cooldown');
  advance(game, .6); assert.equal(bonks(game).length, 0, 'a swing cannot repeatedly bonk during the follow-through');
});

test('an empty or skyward hammer swing makes no impact effects or crime', () => {
  for (const pitch of [0, 1.2]) {
    const game = fixture(); if (pitch) resident(game);
    game.action(0, { pitch }); advance(game, .95);
    assert.equal(game.ragdolls.bodies.size, 0); assert.equal(game.particles.length, 0);
    assert.equal(bonks(game).length, 0); assert.equal(game.heat, 0); assert.equal(game._witnessReports.length, 0);
  }
});

test('hammer contact checks where targets are when the windup finishes', () => {
  for (const entering of [true, false]) {
    const game = fixture(), person = resident(game, entering ? 1030 : 940);
    game.action(0); game.update(.1);
    person.x = person.homeX = entering ? 940 : 1030;
    game.update(.12);
    assert.equal(Boolean(game.ragdolls.get(person.id)), entering, entering ? 'a target can enter the swing' : 'a target can dodge during windup');
    assert.equal(bonks(game).length, entering ? 1 : 0);
  }
});

test('rotated vehicle surfaces are reachable even when their centres are outside hammer range', () => {
  for (const [x, expected] of [[980, true], [1030, false]]) {
    const game = fixture(), car = game._addCar(x, 900, Math.PI / 4, 'van', '#ffd15b');
    game.action(0); game.update(.22);
    const body = game.vehiclePhysics.get(car.id);
    assert.equal(body.velocity.x > 1, expected); assert.equal(body.velocity.y > 1, expected);
    assert.equal(bonks(game).length, expected ? 1 : 0);
  }
});

test('the cartoon launch lifts vehicles up and back while heavier chassis move less', () => {
  const launch = kind => {
    const game = fixture(), car = ride(game, kind);
    game.action(0); game.update(.22);
    const body = game.vehiclePhysics.get(car.id);
    assert.ok(body.velocity.x > 1, kind + ' receives a substantial backward launch');
    assert.ok(body.velocity.y > 1, kind + ' receives visible lift');
    assert.equal(bonks(game).length, 1);
    return body.velocity.clone();
  };
  const compact = launch('compact'), van = launch('van'), tank = launch('tank');
  assert.ok(compact.x > van.x && van.x > tank.x, 'mass reduces horizontal velocity change');
  assert.ok(compact.y > van.y && van.y > tank.y, 'mass reduces the upward velocity change');
  const game = fixture(), patrol = { id: 'hammer-patrol', ...game._vehicleState('compact'),
    x: 963, y: 900, elevation: 0, angle: 0, speed: 0, route: [], routeTimer: 999 };
  game.police.push(patrol); game.action(0); game.update(.22);
  const body = game.vehiclePhysics.get(patrol.id);
  assert.ok(body.velocity.x > tank.x && body.velocity.y > tank.y, 'police cars get the same light-chassis slapstick');
  assert.ok(patrol.distracted > 0); assert.equal(game.heat, 1);
});

test('residents launch away from the hammer and lighter people tumble faster', () => {
  const velocity = mass => {
    const game = fixture(), person = resident(game, 940, { mass });
    game.action(0); game.update(.22);
    const body = game.ragdolls.get(person.id);
    assert.ok(body, 'a landed blow creates the articulated tumble');
    const joint = body.joints.chest;
    return { x: (joint.x - joint.px) * 120, y: (joint.y - joint.py) * 120, z: (joint.z - joint.pz) * 120 };
  };
  const light = velocity(40), heavy = velocity(140);
  assert.ok(heavy.x > 5 && heavy.y > 4, 'even a heavy resident gets an exaggerated up-and-away launch');
  assert.ok(light.x > heavy.x && light.y > heavy.y, 'person mass reduces both parts of the impulse');
  assert.ok(Math.abs(light.z) < .01 && Math.abs(heavy.z) < .01, 'the centre of mass travels along the attack direction');
});

test('actual hammer contact launches helicopter surfaces and preserves the airframe momentum afterward', () => {
  const launch = type => {
    const game = fixture(), model = Aircraft.getModel(type);
    game.aircraft.length = 0;
    game.aviation._policeCooldown = game.aviation._newsCooldown = 10000;
    const nose = model.collisionParts.find(part => part.name === 'nose' || part.name === 'cockpit');
    // The models have long tails and off-centre noses. Align the actual nose
    // face forty units ahead of the player while the aircraft faces them.
    const craft = game.aviation.spawn(type, { x: 940 + (nose.offset[0] + nose.half[0]) * 20,
      y: 900, elevation: 0, angle: Math.PI });
    game.vehiclePhysics.sync(); game.action(0, { pitch: 0 }); game.update(.2);
    assert.equal(craft.vx, 0); assert.equal(craft.verticalVelocity, 0); assert.equal(bonks(game).length, 0);
    game.update(.02);
    const launchVelocity = { x: craft.vx, y: craft.verticalVelocity };
    assert.ok(launchVelocity.x > 20 && launchVelocity.y > 1, type + ' receives an actual hammer up-and-away impulse');
    assert.equal(bonks(game).length, 1);
    const before = { x: craft.x, elevation: craft.elevation }; game.update(.1);
    assert.ok(craft.x > before.x + 2 && craft.elevation > before.elevation, type + ' continues moving through the real flight update');
    assert.ok(craft.vx > 0, 'a parked aircraft controller preserves the shove');
    return launchVelocity;
  };
  const light = launch('helicopter'), heavy = launch('transportheli');
  assert.ok(light.x > heavy.x && light.y > heavy.y, 'the heavier transport receives a smaller velocity change');
});

test('intact scenery and vehicle bodies shield people for the current swing', () => {
  for (const cover of ['prop', 'vehicle']) {
    const game = fixture(), person = resident(game, cover === 'prop' ? 945 : 960);
    if (cover === 'prop') game.staticObjects = [{ id: 'hammer-fence', kind: 'fence', x: 925, y: 900, elevation: 0,
      destructible: true, health: 25, parts: [{ offset: [0, .8, 0], half: [.2, .8, 1] }] }];
    else game._addCar(938, 900, Math.PI / 2, 'compact', '#ffd15b');
    game.vehiclePhysics.sync(); game.action(0); game.update(.22);
    assert.equal(Boolean(game.ragdolls.get(person.id)), false, cover + ' blocks the person behind it');
    assert.equal(bonks(game).length, 1, 'the cover itself receives the impact');
    if (cover === 'prop') assert.equal(game.staticObjects[0].destroyed, true, 'breaking cover does not retroactively expose its victim');
  }
});

test('vehicle hammer impulses add to momentum and are independent of update batch size', () => {
  const prepare = moving => {
    const game = fixture(), car = ride(game, 'compact', moving ? { vx: 60, speed: 60 } : {});
    game.vehiclePhysics.sync(); game.action(0); return { game, car };
  };
  const still = prepare(false), moving = prepare(true);
  still.game.update(.22); moving.game.update(.22);
  assert.ok(moving.car.vx > still.car.vx + 10, 'a forward moving target keeps its existing momentum');
  const a = prepare(false), b = prepare(false);
  a.game.update(.25); advance(b.game, .25);
  assert.deepEqual({ x: a.car.x, y: a.car.y, vx: a.car.vx, vy: a.car.vy, elevation: a.car.elevation, lift: a.car.verticalVelocity },
    { x: b.car.x, y: b.car.y, vx: b.car.vx, vy: b.car.vy, elevation: b.car.elevation, lift: b.car.verticalVelocity });
  assert.equal(bonks(a.game).length, 1); assert.equal(bonks(b.game).length, 1);
  advance(a.game, .5); assert.equal(bonks(a.game).length, 0);
});

test('switching toys during the windup cancels the pending hammer contact', () => {
  const game = fixture(), person = resident(game);
  game.action(0); game.update(.1); assert.equal(game.equipGadget('popper'), true); advance(game, .3);
  assert.equal(game.ragdolls.get(person.id), undefined); assert.equal(game.particles.length, 0); assert.equal(bonks(game).length, 0);
});
