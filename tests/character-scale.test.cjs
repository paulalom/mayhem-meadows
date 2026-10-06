const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../core.js');
const { PERSON_HEIGHT, MUZZLE_HEIGHT, PLAYER_RADIUS, RagdollWorld, STEP } = require('../physics.js');

test('standing contacts clear the same low overhead car that fits the smaller head', () => {
  const game = new Game({ seed: 17 });
  const car = { id: 'overhead', kind: 'compact', x: 1000, y: 1000, angle: 0,
    elevation: PERSON_HEIGHT + 0.03, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const person = game.player;
  Object.assign(person, { x: 1000, y: 1000, elevation: 0 });
  assert.equal(game._personVehicleContact(person, car), null, 'old full-size capsule does not survive beneath the smaller mesh');
  car.elevation = PERSON_HEIGHT - 0.03;
  const hit = game._personVehicleContact(person, car);
  assert.ok(hit && hit.vertical && hit.up < 0, 'lowering the real underside contacts the smaller head');
});

test('standing clearance uses the smaller player radius at building corners', () => {
  const game = new Game({ seed: 17 });
  game.cars = []; game.police = []; game.staticObjects = []; game._streetParts = null;
  game.buildings = [{ x: 1000 + PLAYER_RADIUS + 0.5, y: 980, w: 20, h: 40, height: 3 }];
  assert.equal(game._personFree(1000, 1000), true, 'a narrow valid clearance uses the smaller default radius');
  assert.equal(game._personFree(1000.75, 1000), false, 'the smaller body still collides when it reaches the wall');
});

test('cannon muzzle follows the scaled shoulder while jump speed stays unchanged', () => {
  const game = new Game({ seed: 17 });
  game.inventory.unlocked.push('cannon'); game.inventory.equipped = 'cannon'; game.inventory.ammo.cannon = 2;
  game.player.elevation = 2;
  assert.equal(game.action(0, { pitch: 0 }), true);
  assert.equal(game.projectiles[0].startHeight, 2 + MUZZLE_HEIGHT);
  game.player.elevation = 0; game.player.grounded = true;
  assert.equal(game.jump(), true);
  assert.equal(game.player.verticalVelocity, 7.2, 'character size does not change the fun jump arc');
});

test('getting up beside a car does not expand the player into a standing contact', () => {
  const game = new Game({ seed: 17 }), world = new RagdollWorld();
  const car = { id: 'roof', kind: 'compact', x: 1000, y: 1000, angle: 0, colliderHeight: 1.3,
    elevation: 0, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const person = game.player;
  Object.assign(person, { x: 1000, y: 1000, angle: 0 });
  world.trigger(person, {}, { height: 2 });
  for (let i = 0; i < 456; i++) world.step(STEP, { cars: [car] });
  assert.equal(world.bodies.size, 0);
  assert.equal(game._personVehicleContact(person, car), null, 'ragdoll recovery reserves space for the real standing capsule');
});
