'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, CAR_TYPES } = require('../core.js');
const { VehicleWorld } = require('../vehicle-physics.js');
const { RagdollWorld, PLAYER_RADIUS } = require('../physics.js');
const { TrainSystem, MODELS } = require('../trains.js');
const { AlienSystem } = require('../aliens.js');
const { AircraftSystem } = require('../aircraft.js');

const BOUNDS = { minX: 0, minY: -4000, maxX: 12000, maxY: 8000 };
function flatGame() {
  const game = Object.create(Game.prototype);
  const terrain = { heightAt: () => 0, surfaceHeight: () => 0, isWater: () => false };
  Object.assign(game, { world: { size: 12000, bounds: { ...BOUNDS }, terrain }, terrain, cars: [], police: [], buildings: [], staticObjects: [], peds: [],
    player: { id: 'player', x: 1000, y: -2000, angle: 0, composure: 100, elevation: 0, grounded: true }, score: 100, _environmentVersion: 0,
    _toast() {}, _confetti() {}, _sound() {}, ragdolls: new RagdollWorld() });
  return game;
}
function car(x, y, angle = 0) {
  return { id: 'north-car', kind: 'compact', x, y, angle, speed: 0, vx: 0, vy: 0, elevation: 0, verticalVelocity: 0 };
}

test('walking, vehicle footprints and collision resolution use the north extension and true southern edge', () => {
  const game = flatGame(), person = game.player, ride = car(1800, -1200);
  assert.equal(game._isFree(person.x, person.y), true);
  assert.equal(game._vehicleFree(ride), true);
  game._moveCircleBuildings(person, 0, -100, PLAYER_RADIUS);
  assert.equal(person.y, -2100);
  game._resolveVehicle(ride); assert.equal(ride.y, -1200);
  game._moveCircleBuildings(person, 0, -4000, PLAYER_RADIUS);
  assert.equal(person.y, BOUNDS.minY + PLAYER_RADIUS);
  assert.equal(game._isFree(1000, BOUNDS.minY - 1), false);
  assert.equal(game._isFree(1000, BOUNDS.maxY + 1), false);
  ride.y = -5000; game._resolveVehicle(ride);
  const halfWidth = CAR_TYPES.compact.width / 2;
  assert.equal(ride.y, BOUNDS.minY + halfWidth);
  delete game.world.bounds;
  assert.equal(game._isFree(1000, -100), false, 'legacy fixtures retain a zero northern edge');
});

test('road recovery and parachute touchdown remain in the northern ground world', () => {
  const game = flatGame();
  game.network = { nearestRoad: () => ({ roadId: 'base-access', s: 500, x: 1000, y: -1900, angle: 0 }),
    pointOnRoad: (_id, s, lane) => ({ x: 500 + s, y: -1900 + lane, angle: 0 }) };
  game.nodes = [{ id: 'base-gate', x: 1000, y: -1900 }];
  assert.equal(game.recover(), true); assert.equal(game.player.y, -1900);
  const ride = car(1200, -2200); game.cars.push(ride); game.player.vehicleId = ride.id;
  game.vehiclePhysics = new VehicleWorld(game, CAR_TYPES);
  game.recover(); assert.equal(ride.y, -1900); assert.equal(game.player.y, -1900);
  assert.ok(Math.abs(game.vehiclePhysics.get(ride.id).position.z * 20 + 1900) < 1e-9);
  game.player.vehicleId = null; game.player.y = -2000; game.player.elevation = .1; game.player.verticalVelocity = -4; game.player.parachuting = true;
  game.aviation = { bounds: { minX: -12000, minY: -12000, maxX: 24000, maxY: 20000 } };
  let recoveries = 0; game.recover = () => recoveries++;
  game._parachuteStep(.1, {});
  assert.equal(game.player.parachuting, false); assert.equal(game.player.y, -2000); assert.equal(recoveries, 0);
});

test('Cannon heightfield uses rectangular rows and displaced north grid origin without shifting city samples', () => {
  const count = 4, rows = 5, step = 100, originY = -200, heights = new Float32Array(count * rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < count; col++) heights[row * count + col] = 2 + col * .5 + row * .75;
  const heightAt = (x, y) => 2 + Math.max(0, Math.min(count - 1, x / step)) * .5 + Math.max(0, Math.min(rows - 1, (y - originY) / step)) * .75;
  const terrain = { count, rows, step, originX: 0, originY, minY: -150, heights, heightAt, surfaceHeight: heightAt };
  const game = { world: { size: 300, bounds: { minX: 0, minY: -150, maxX: 300, maxY: 150 }, terrain }, terrain,
    cars: [], police: [], buildings: [], staticObjects: [] };
  const world = new VehicleWorld(game, CAR_TYPES);
  assert.equal(world.floor.position.z, originY / 20);
  assert.equal(world.heightfield.data.length, rows); assert.equal(world.heightfield.data[0].length, count);
  for (const [x, y] of [[40, -120], [260, -40], [140, 0], [210, 140]])
    assert.ok(Math.abs(world.support(x, y, 20) - heightAt(x, y)) < 1e-9, `shared heightfield at ${x},${y}`);
  const walls = world.world.bodies.filter(body => body.kind === 'boundary');
  assert.equal(walls.length, 4); assert.ok(walls.some(body => body.position.z === -160 / 20));
  assert.equal(walls.some(body => body.position.z === -.5), false, 'no wall remains at the former northern edge');
  const floor = world.floor, oldWalls = [...walls]; game.world.bounds = { ...game.world.bounds, minY: -180 }; world.sync();
  assert.equal(world.floor, floor); assert.ok(oldWalls.every(body => !world.world.bodies.includes(body)));
  assert.ok(world.world.bodies.some(body => body.kind === 'boundary' && body.position.z === -190 / 20));
});

test('a driven car crosses y zero and the outer north wall physically contains it', () => {
  const game = flatGame(), ride = car(1000, 45, -Math.PI / 2); game.cars.push(ride);
  ride.speed = 180; ride.vy = -180;
  const world = new VehicleWorld(game, CAR_TYPES);
  for (let i = 0; i < 60; i++) world.step(1 / 60);
  assert.ok(ride.y < -80, 'the old edge permits continuous ground driving');
  assert.ok(Math.abs(ride.elevation) < .08);
  Object.assign(ride, { y: -3940, speed: 180, vx: 0, vy: -180, elevation: 0, orientation: null }); world.sync();
  let bounced = false;
  for (let i = 0; i < 60; i++) { world.step(1 / 60); bounced ||= ride.vy > 20; assert.ok(ride.y > -4001); }
  assert.ok(bounced, 'the actual north boundary reverses chassis velocity');
});

test('ragdoll joints and recovery use explicit rectangular bounds in metres', () => {
  const world = new RagdollWorld(), person = { id: 'player', x: 1000, y: -3965, angle: -Math.PI / 2, elevation: 3 };
  const terrain = { heightAt: () => 3, surfaceHeight: () => 3 };
  world.trigger(person, { x: 0, y: 2, z: -6 });
  let completed = [];
  for (let i = 0; i < 240; i++) {
    completed.push(...world.step(1 / 60, { bounds: BOUNDS, size: 12000, terrain }));
    const body = world.get(person.id);
    if (body) for (const joint of Object.values(body.joints)) assert.ok(joint.z >= BOUNDS.minY / 20 + joint.radius - 1e-7);
  }
  assert.equal(completed.length, 1); assert.ok(person.y < -3800 && person.y > -4000);
  assert.ok(Math.abs(person.elevation - 3) < .01);
});

test('train cars become visible at the moved portal and sample northern grades', () => {
  const system = Object.create(TrainSystem.prototype), calls = [];
  system.layout = { portalY: -4000 };
  system.game = { world: { terrain: { minY: -4000, heightAt(x, y) { calls.push(y); return 10 + (y + 4000) * .001; } } } };
  const route = { length: 1000, points: [{ x: 7000, y: -4000, s: 0 }, { x: 7000, y: -3000, s: 1000 }] };
  const train = { leg: 'inbound', route, front: 250, speed: 50, cars: [{ railModel: MODELS.passenger, x: 7000, y: -4200, elevation: 10 }] };
  system._pose(train, 1 / 60);
  assert.equal(train.cars[0].visible, true); assert.ok(train.cars[0].y < 0);
  assert.ok(calls.every(y => y < 0 && y >= -4000)); assert.ok(train.cars[0].pitch > 0);
  train.front = -100; system._pose(train, 1 / 60); assert.equal(train.cars[0].visible, false);
  assert.ok(calls.every(y => y >= -4000), 'off-map wheels clamp to the portal grade');
});

test('ambient alien visits stay over civilian city bounds and clear both airport approaches', () => {
  const game = { _seed: 42, world: { mapWidth: 12000, mapHeight: 12000, bounds: BOUNDS, landscape: {} }, peds: [
    { id: 'town-person', x: 5000, y: 3000, grounded: true }, { id: 'base-person', x: 4000, y: -2500, grounded: true },
    { id: 'outside-south', x: 5000, y: 9000, grounded: true }], buildings: [], _ground: () => 3, _dry: () => true };
  const system = new AlienSystem(game, { populate: false });
  assert.equal(system._openSky(game.peds[1]), false); assert.equal(system._openSky(game.peds[2]), false);
  for (let i = 0; i < 50; i++) {
    assert.equal(system.startVisit(), true); assert.equal(system.targetId, 'town-person');
    assert.ok(system.saucer.x < 0 || system.saucer.y > BOUNDS.maxY);
    assert.ok(system.saucer.y >= 500 && system.exit.y >= 500);
    system.saucer.visible = false;
  }
});

function hangarFixture() {
  const game = flatGame();
  game.terrain.heightAt = game.terrain.surfaceHeight = (_x, y) => y < 0 ? 14 : 0;
  const civilian = { aprons: [{ x: 10000, y: 3000, w: 800, h: 1800, elevation: 0 }],
    stands: [{ id: 'civil-trainer', aircraftType: 'trainer', x: 10400, y: 3500, angle: 0, elevation: 0 }],
    militaryStands: [{ id: 'civil-visiting-fighter', aircraftType: 'fighter', x: 10400, y: 4000, angle: 0, elevation: 0 }],
    helipads: [{ id: 'civil-heli', x: 10400, y: 4500, radius: 150, elevation: 0 }] };
  const military = { id: 'military', runways: [{ x: 2400, y: -3000, w: 6000, h: 300 }],
    aprons: [{ x: 3000, y: -2200, w: 2200, h: 800, elevation: 14 }],
    stands: [{ id: 'base-fighter', aircraftType: 'fighter', x: 3500, y: -1800, angle: 0, elevation: 14 }],
    storageStands: [{ id: 'base-reserve', aircraftType: 'fighter', x: 4100, y: -1800, angle: 0, elevation: 14 }],
    helipads: [{ id: 'base-heavy', aircraftType: 'transportheli', x: 4700, y: -1800, radius: 170, elevation: 14 }] };
  game.world.landscape = { airport: civilian, militaryBase: military };
  game.hangar = { aircraft: [] };
  game.aviation = new AircraftSystem(game, { spawn: false }); game.aircraft = game.aviation.aircraft;
  Object.assign(game.player, { x: 3050, y: -1500, elevation: 14 });
  return { game, civilian, military };
}

test('hangar access supports both airfields and requires a stopped occupant at ground height', () => {
  const { game, civilian, military } = hangarFixture();
  assert.equal(game.hangarAvailable, true);
  Object.assign(game.player, { x: 4700, y: -1800 }); assert.equal(game.hangarAvailable, true, 'base helipad is a hangar service location');
  game.player.elevation = 25; assert.equal(game.hangarAvailable, false, 'standing on an elevated surface above the apron cannot access it');
  game.player.elevation = 14; game.player.parachuting = true; assert.equal(game.hangarAvailable, false); game.player.parachuting = false;
  game.player.grounded = false; assert.equal(game.hangarAvailable, false); game.player.grounded = true;
  Object.assign(game.player, civilian.helipads[0]); assert.equal(game.hangarAvailable, true, 'civil helipads do not depend on an id naming convention');
  const craft = game.aviation.spawn('fighter', military.stands[0]);
  game.player.vehicleId = craft.id; assert.equal(game.hangarAvailable, true);
  craft.speed = 21; assert.equal(game.hangarAvailable, false); craft.speed = 0;
  craft.grounded = false; assert.equal(game.hangarAvailable, false); craft.grounded = true;
  const roadCar = car(3500, -1800); roadCar.elevation = 14; game.cars.push(roadCar); game.player.vehicleId = roadCar.id;
  assert.equal(game.hangarAvailable, false);
});

test('stored aircraft retrieve at the current airfield, preserve damage and adopt local recovery homes without duplication', () => {
  const { game, civilian, military } = hangarFixture();
  const craft = game.aviation.spawn('fighter', military.stands[0]);
  Object.assign(craft, { health: 175, engineHealth: 65, handlingHealth: 72 });
  game.player.vehicleId = craft.id; assert.equal(game.hangarStore(), true); const id = craft.hangarId;
  assert.equal(game.hangarRetrieve(id), true); assert.equal(game.current, craft); assert.equal(craft.airportId, 'military');
  game.player.vehicleId = null; Object.assign(game.player, { x: civilian.aprons[0].x + 20, y: 3450, elevation: 0, grounded: true });
  game.aviation.airports.military.runwayReservation = craft.id;
  game.aviation.airports.civilian.runwayReservation = 'another-civil-flight';
  assert.equal(game.hangarRetrieve(id), true);
  assert.equal(game.aircraft.length, 1); assert.equal(game.current, craft); assert.equal(craft.airportId, 'civilian');
  assert.equal(craft.standId, 'civil-visiting-fighter'); assert.equal(craft.home.id, craft.standId); assert.ok(craft.home.y > 0);
  assert.equal(game.aviation.airports.military.runwayReservation, null); assert.equal(game.aviation.airports.civilian.runwayReservation, 'another-civil-flight');
  assert.equal(craft.health, 175); assert.equal(craft.engineHealth, 65); assert.equal(craft.handlingHealth, 72);
  Object.assign(craft, { x: 8000, y: 6000, elevation: 80, grounded: false });
  assert.equal(game.aviation.recover(craft), true); assert.equal(craft.y, craft.home.y); assert.ok(craft.y > 0);
  game.player.vehicleId = null; Object.assign(game.player, { x: 3050, y: -1500, elevation: 14, grounded: true });
  assert.equal(game.hangarRetrieve(id), true); assert.equal(game.aircraft.length, 1);
  assert.equal(craft.airportId, 'military'); assert.equal(craft.standId, 'base-reserve'); assert.equal(craft.home.id, 'base-reserve');
  Object.assign(craft, { x: 8000, y: 6000, elevation: 80, grounded: false });
  assert.equal(game.aviation.recover(craft), true); assert.equal(craft.y, military.stands[0].y); assert.equal(craft.elevation, 14);
});

test('an undeployed hangar record spawns at the base instead of its default civilian field', () => {
  const { game } = hangarFixture();
  game.hangar.aircraft.push({ id: 'air-1', kind: 'aircraft', aircraftType: 'fighter', health: 200, maxHealth: 260, engineHealth: 80, handlingHealth: 90 });
  assert.equal(game.hangarRetrieve('air-1'), true); assert.equal(game.aircraft.length, 1);
  assert.equal(game.current.airportId, 'military'); assert.ok(game.current.y < 0);
  assert.equal(game.current.standId, 'base-reserve'); assert.equal(game.current.home.id, 'base-reserve');
  assert.equal(game.current.health, 200); assert.equal(game.current.engineHealth, 80);
});

test('actual base utilities and aircraft support normal entry, driving, hangar and recovery in the northern district', () => {
  const game = new Game({ seed: 42 }), base = game.world.militaryBase;
  const utilities = game.cars.filter(vehicle => vehicle.baseId === 'military');
  assert.equal(utilities.length, base.vehicleSpawns.length);
  for (const vehicle of utilities) {
    assert.equal(vehicle.militaryModel, 'utility-truck'); assert.equal(vehicle.modelId, 'tumble-hauler');
    assert.equal(vehicle.kind, 'van'); assert.equal(vehicle.traffic, false); assert.ok(vehicle.y < 0);
    assert.equal(game._vehicleFree(vehicle), true); assert.ok(game.vehicleStats(vehicle).driveable);
  }
  const ride = utilities[0];
  Object.assign(game.player, { vehicleId: null, x: ride.x + 50, y: ride.y, elevation: ride.elevation, grounded: true });
  assert.equal(game.interact(), true); assert.equal(game.current, ride, 'E boards the base utility');
  const oldY = ride.y;
  for (let i = 0; i < 24; i++) game.update(1 / 60, { up: true });
  assert.ok(ride.y > oldY + 5 && ride.y < 0); assert.ok(Math.abs(ride.elevation - game._ground(ride)) < .1);
  Object.assign(ride, { health: 73, engineHealth: 81, elevation: 35, upright: false });
  const money = game.money;
  assert.equal(game.recover(), true); assert.ok(ride.y < 0); assert.equal(game.current, ride);
  assert.equal(ride.health, 73); assert.equal(ride.engineHealth, 81); assert.equal(game.money, money);
  assert.equal(ride.militaryModel, 'utility-truck'); assert.equal(ride.modelId, 'tumble-hauler');
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null); assert.ok(game.player.y < 0);
  const fighter = game.aircraft.find(aircraft => aircraft.airportId === 'military' && aircraft.aircraftType === 'fighter' && !aircraft.npc);
  assert.ok(fighter);
  Object.assign(game.player, { x: fighter.x + 160, y: fighter.y, elevation: fighter.elevation, grounded: true });
  assert.equal(game.interact(), true); assert.equal(game.current, fighter, 'E boards the base fighter');
  assert.equal(game.hangarAvailable, true, 'G opens hangar service at the military apron');
  assert.equal(game.hangarStore(), true); assert.equal(game.hangarRetrieve(fighter.hangarId), true);
  assert.equal(fighter.airportId, 'military'); assert.ok(fighter.home.y < 0);
  Object.assign(fighter, { health: 200, engineHealth: 85, elevation: 70, grounded: false });
  assert.equal(game.recover(), true); assert.equal(game.current, fighter); assert.ok(fighter.y < 0);
  assert.equal(fighter.health, 200); assert.equal(fighter.engineHealth, 85); assert.equal(game.hangarAvailable, true);
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null); assert.ok(game.player.y < 0);
});
