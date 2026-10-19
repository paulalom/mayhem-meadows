'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AircraftSystem } = require('../aircraft.js');

function fixture(type = 'helicopter', ground = 0) {
  const game = {
    world: { mapWidth: 12000, mapHeight: 8000 },
    player: { id: 'player', x: 1000, y: 1000, elevation: ground, grounded: true, vehicleId: null },
    heat: 0, cars: [], police: [], peds: [], buildings: [], staticObjects: [],
    _ground: () => ground, _blockedLine: () => false
  };
  const aviation = new AircraftSystem(game, { spawn: false });
  const entity = aviation.spawn(type, { x: 6000, y: 4000, elevation: ground, angle: Math.PI / 2 });
  return { aviation, entity, game };
}

function advance(aviation, duration, hz = 60) {
  for (let tick = 0; tick < Math.round(duration * hz); tick++) aviation.step(1 / hz);
}

test('aircraft shoves persist across flight updates in world space rather than following the nose', () => {
  const { aviation, entity } = fixture();
  assert.equal(aviation.impulse(entity, { x: 8, y: 6, z: 0 }), entity);
  assert.equal(entity.vx, 160); assert.equal(entity.vy, 0);
  assert.equal(entity.vz, 6); assert.equal(entity.verticalVelocity, 6); assert.equal(entity.grounded, false);
  advance(aviation, .25);
  assert.ok(entity.x > 6030, 'the parked controller preserves the cross-heading shove');
  assert.equal(entity.y, 4000); assert.equal(entity.angle, Math.PI / 2);
  assert.ok(entity.vx > 100 && entity.vx < 160, 'horizontal momentum decays gradually');
  assert.ok(entity.elevation > .7 && entity.vz > 0, 'the shove lifts the airframe');
  const x = entity.x;
  advance(aviation, .25);
  assert.ok(entity.x > x + 20, 'momentum survives more than one simulation tick');
  assert.ok(entity.vz < 0, 'a parked helicopter falls after the launch instead of hovering forever');
  advance(aviation, 1);
  assert.equal(entity.elevation, 0); assert.equal(entity.vz, 0); assert.equal(entity.grounded, true);
});

test('plane and helicopter launches land on elevated terrain and settle at different frame rates', () => {
  for (const type of ['trainer', 'helicopter', 'transportheli']) for (const hz of [30, 60, 120]) {
    const { aviation, entity } = fixture(type, 14);
    aviation.impulse(entity, { x: 5, y: 7, z: -2 });
    advance(aviation, .1, hz);
    assert.ok(entity.elevation > 14, type + ' leaves the ground at ' + hz + ' Hz');
    assert.ok(entity.x > 6005 && entity.y < 4000, type + ' moves in the world shove direction');
    advance(aviation, 3, hz);
    assert.equal(entity.elevation, 14, type + ' lands on the terrain');
    assert.equal(entity.verticalVelocity, 0); assert.equal(entity.grounded, true);
    assert.ok(Math.hypot(entity.vx, entity.vy) < .1, type + ' settles after landing');
  }
});

test('aircraft impulse vectors add to current momentum and leave mass scaling to the caller', () => {
  for (const type of ['helicopter', 'transportheli']) {
    const { aviation, entity } = fixture(type);
    entity.vz = 2;
    aviation.impulse(entity, { x: 3, y: 4, z: -2 });
    aviation.impulse(entity, { x: 2, y: 1, z: -1 });
    assert.equal(entity.vx, 100); assert.equal(entity.vy, -60); assert.equal(entity.vz, 7);
    advance(aviation, .1);
    assert.ok(entity.x > 6008 && entity.y < 3995, type + ' retains both shoves');
  }
});

test('aircraft recovery clears pending shove momentum', () => {
  const { aviation, entity } = fixture();
  aviation.impulse(entity, { x: 8, y: 6, z: -3 });
  advance(aviation, .1);
  assert.equal(aviation.recover(entity), true);
  const { x, y, elevation } = entity;
  advance(aviation, .5);
  assert.equal(entity.x, x); assert.equal(entity.y, y); assert.equal(entity.elevation, elevation);
  assert.equal(entity.vx, 0); assert.equal(entity.vy, 0); assert.equal(entity.vz, 0);
});

test('clearing an aircraft shove stops transient drift and preserves ordinary flight momentum', () => {
  const { aviation, entity } = fixture();
  entity.vz = 2; entity.vy = entity.speed = 30;
  aviation.impulse(entity, { x: 8, y: 6, z: -3 });
  assert.equal(aviation.clearImpulse(entity), true);
  assert.equal(entity.vx, 0); assert.equal(entity.vy, 30); assert.equal(entity.vz, 2);
  assert.equal(aviation.clearImpulse(entity), false);
  entity.vy = entity.speed = entity.vz = entity.verticalVelocity = 0;
  entity.grounded = true;
  aviation.impulse(entity, { x: 8, y: 0, z: -3 });
  advance(aviation, .1);
  assert.equal(aviation.clearImpulse(entity), true);
  const { x, y } = entity;
  advance(aviation, .5);
  assert.equal(entity.x, x); assert.equal(entity.y, y); assert.equal(entity.vx, 0); assert.equal(entity.vy, 0);
});

test('sideways aircraft launches use swept collision and rebound instead of pushing through a wall', () => {
  const { aviation, entity, game } = fixture();
  game.buildings = [{ x: 6230, y: 3700, w: 4, h: 600, height: 20, elevation: 0 }];
  aviation.impulse(entity, { x: 25, y: 6, z: 0 });
  advance(aviation, .5);
  assert.ok(entity.x > 6100 && entity.x < 6230, 'the full airframe sweep stops before the wall');
  assert.ok(entity.vx < 0, 'the external lateral momentum rebounds at contact');
  assert.ok(entity.health < entity.maxHealth, 'collision severity includes lateral shove speed');
  advance(aviation, 1);
  assert.equal(entity.grounded, true); assert.equal(entity.elevation, 0); assert.equal(entity.verticalVelocity, 0);
  assert.ok(entity.x < 6100, 'the rebounding airframe moves away from the obstruction');
});
