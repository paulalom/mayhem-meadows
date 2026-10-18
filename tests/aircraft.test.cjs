'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AircraftSystem, AIRCRAFT_TYPES, isAircraft, getModel } = require('../aircraft.js');

function fixture(options = {}) {
  const events = [];
  const airport = {
    runways: [{ x: 10920, y: 2300, w: 280, h: 2200, thresholds: [{ id: 'north', x: 11060, y: 2440, angle: Math.PI / 2 }, { id: 'south', x: 11060, y: 4360, angle: -Math.PI / 2 }] }],
    departureThresholdId: 'south',
    taxiways: [{ x: 10700, y: 2480, w: 90, h: 2020 }],
    aprons: [{ x: 10370, y: 2850, w: 390, h: 1900 }],
    stands: [{ id: 'trainer-1', aircraftType: 'trainer', x: 10530, y: 3030, angle: 0 }, { id: 'trainer-2', aircraftType: 'trainer', x: 10530, y: 3330, angle: 0 }, { id: 'commuter-1', aircraftType: 'commuter', x: 10530, y: 3670, angle: 0 }],
    helipads: [{ id: 'heli', aircraftType: 'helicopter', x: 10495, y: 4040, angle: 0 }, { id: 'news', aircraftType: 'news', x: 10495, y: 4360, angle: 0 }, { id: 'police', aircraftType: 'policeheli', x: 10495, y: 4680, angle: 0 }],
    militaryStands: [{ id: 'heavy', aircraftType: 'transportheli', x: 10580, y: 2110, angle: 0 }, { id: 'jet', aircraftType: 'fighter', x: 10495, y: 2600, angle: -Math.PI / 2 }]
  };
  airport.taxiRoutes = airport.stands.map(stand => ({ standId: stand.id, points: [{ x: 10745, y: stand.y }, { x: 10745, y: 4360 }, { x: 11060, y: 4360 }] }));
  const game = {
    world: { mapWidth: 12000, mapHeight: 8000, landscape: { airport, airspace: { minX: -12000, minY: -12000, maxX: 24000, maxY: 20000 } } },
    player: { id: 'player', x: 6000, y: 4000, elevation: 0, angle: 0, grounded: true, vehicleId: null, composure: 100 },
    heat: 0, cars: [], police: [], peds: [], buildings: [], staticObjects: [],
    _ground: () => 0, _blockedLine: () => false, _isFree: () => true,
    _toast: (text, kind) => events.push({ text, kind }),
    _damageVehicle: (entity, amount) => { entity.health -= amount; },
    ...options
  };
  const aviation = new AircraftSystem(game, { spawn: false });
  game.aviation = aviation; game.aircraft = aviation.aircraft;
  Object.defineProperty(game, 'current', { get: () => aviation.current || game.player });
  return { game, aviation, events, airport };
}

const advance = (aviation, seconds, input = {}) => {
  for (let tick = 0; tick < Math.round(seconds * 60); tick++) aviation.step(1 / 60, input);
};
const board = (game, aviation, entity) => {
  Object.assign(game.player, { x: entity.x, y: entity.y + 100, elevation: entity.elevation, grounded: true });
  assert.equal(aviation.enterNearest(), true);
  assert.equal(aviation.current, entity);
};

test('all seven aircraft share a player/NPC flight contract and distinct flight models', () => {
  assert.deepEqual(Object.keys(AIRCRAFT_TYPES), ['trainer', 'commuter', 'helicopter', 'news', 'policeheli', 'transportheli', 'fighter']);
  const { aviation } = fixture();
  for (const [index, type] of Object.keys(AIRCRAFT_TYPES).entries()) {
    const entity = aviation.spawn(type, { x: 1000 + index * 600, y: 1000 });
    assert.equal(isAircraft(entity), true);
    assert.equal(getModel(entity), AIRCRAFT_TYPES[type]);
    assert.ok(entity.health > 0 && getModel(entity).maxSpeed > 0);
  }
  assert.equal(getModel('helicopter').helicopter, true);
  assert.equal(getModel('fighter').helicopter, false);
  assert.ok(getModel('fighter').maxSpeed > getModel('commuter').maxSpeed);
});

test('ground interaction transfers ownership, preserves heat and parks with a safe exit', () => {
  const { game, aviation } = fixture({ heat: 2 });
  const entity = aviation.spawn('trainer', { x: 6000, y: 4000 }, { npc: true });
  board(game, aviation, entity);
  assert.equal(entity.npc, false); assert.equal(entity.borrowed, true);
  assert.equal(aviation.interact(), true);
  assert.equal(game.player.vehicleId, null); assert.equal(game.player.grounded, true);
  assert.equal(game.heat, 2); assert.ok(Math.hypot(game.player.x - entity.x, game.player.y - entity.y) > 100);
});

test('airborne pedestrians cannot board and moving or airborne pilots cannot exit normally', () => {
  const { game, aviation } = fixture();
  const entity = aviation.spawn('helicopter', { x: 6000, y: 4000 });
  Object.assign(game.player, { x: entity.x, y: entity.y, grounded: false, elevation: 2 });
  assert.equal(aviation.enterNearest(), false);
  game.player.grounded = true; game.player.elevation = 0;
  assert.equal(aviation.enterNearest(), true);
  entity.grounded = false; entity.elevation = 12;
  assert.equal(aviation.interact(), false); assert.equal(game.player.vehicleId, entity.id);
  entity.grounded = true; entity.speed = 100;
  assert.equal(aviation.interact(), false);
});

test('Space-only helicopter takeoff, hover braking and controlled landing work at fixed steps', () => {
  const { game, aviation } = fixture();
  const entity = aviation.spawn('helicopter', { x: 6000, y: 4000 });
  board(game, aviation, entity);
  advance(aviation, 5, { climb: true });
  assert.ok(entity.elevation > 45 && entity.elevation < 58);
  assert.equal(entity.grounded, false); assert.equal(entity.health, entity.maxHealth);
  advance(aviation, 3, { up: true });
  const fast = entity.speed;
  advance(aviation, 1, { boost: true });
  assert.ok(entity.speed < fast * .3);
  advance(aviation, 8, { descend: true });
  assert.equal(entity.grounded, true); assert.equal(entity.elevation, 0); assert.equal(entity.health, entity.maxHealth);
});

test('full-control helicopter descents land without damage on ground and rooftops at different frame rates', () => {
  for (const type of ['helicopter', 'news', 'policeheli', 'transportheli']) for (const roof of [0, 14]) for (const hz of [30, 60, 120]) {
    const { game, aviation } = fixture({ missionStats: { collisions: 0 }, buildings: roof ? [{ x: 5750, y: 3750, w: 500, h: 500, height: roof, elevation: 0 }] : [] });
    const entity = aviation.spawn(type, { x: 6000, y: 4000, elevation: roof + 30 });
    game.player.vehicleId = entity.id;
    for (let tick = 0; tick < hz * 6; tick++) aviation.step(1 / hz, { descend: true });
    const context = type + ' on ' + (roof ? 'roof' : 'ground') + ' at ' + hz + ' Hz';
    assert.equal(entity.grounded, true, context); assert.equal(entity.elevation, roof, context);
    assert.equal(entity.health, entity.maxHealth, context); assert.equal(entity.engineHealth, 100, context); assert.equal(entity.handlingHealth, 100, context);
    assert.equal(entity.burning, false, context); assert.equal(game.missionStats.collisions, 0, context);
  }
});

test('helicopter touchdown damage starts beyond the safe sink rate and scales with excess speed', () => {
  const touchdown = speed => {
    const { game, aviation } = fixture({ missionStats: { collisions: 0 } });
    const entity = aviation.spawn('helicopter', { x: 6000, y: 4000, elevation: .1 });
    game.player.vehicleId = entity.id; entity.vz = -speed;
    aviation.step(1 / 60, { descend: true });
    assert.equal(entity.grounded, true);
    return { damage: entity.maxHealth - entity.health, collisions: game.missionStats.collisions };
  };
  assert.deepEqual(touchdown(12), { damage: 0, collisions: 0 });
  const fast = touchdown(14), crash = touchdown(20);
  assert.ok(fast.damage > 0 && fast.damage < 20); assert.equal(fast.collisions, 1);
  assert.ok(crash.damage > fast.damage); assert.equal(crash.collisions, 1);
});

test('a trainer lifts from ground, banks and sinks when stalled rather than hovering', () => {
  const { game, aviation } = fixture();
  const entity = aviation.spawn('trainer', { x: 6000, y: 4000, angle: 0 });
  board(game, aviation, entity);
  advance(aviation, 7, { up: true, climb: true });
  assert.ok(entity.elevation > 25); assert.equal(entity.grounded, false);
  const angle = entity.angle;
  advance(aviation, 1, { right: true });
  assert.ok(entity.angle > angle + .4); assert.ok(entity.roll > .4);
  entity.speed = 25; entity.throttle = 0;
  const altitude = entity.elevation;
  advance(aviation, 2, { down: true });
  assert.equal(entity.stalled, true); assert.equal(entity.stallWarning, true); assert.ok(entity.elevation < altitude - 2);
});

test('helicopters land on a physical rooftop without falling to the street', () => {
  const { game, aviation } = fixture({ buildings: [{ x: 5800, y: 3800, w: 400, h: 400, height: 14, elevation: 0 }] });
  const entity = aviation.spawn('helicopter', { x: 6000, y: 4000, elevation: 20 });
  game.player.vehicleId = entity.id;
  advance(aviation, 3, { descend: true });
  assert.equal(entity.elevation, 14); assert.equal(entity.grounded, true);
  assert.equal(aviation.interact(), true); assert.equal(game.player.elevation, 14);
});

test('swept aircraft collision cannot tunnel through a thin building and respects height separation', () => {
  const { game, aviation } = fixture({ buildings: [{ x: 6100, y: 3800, w: 4, h: 400, height: 20, elevation: 0 }] });
  const entity = aviation.spawn('fighter', { x: 5850, y: 4000, elevation: 5 });
  game.player.vehicleId = entity.id; entity.speed = 1500; entity.throttle = 1;
  const health = entity.health;
  advance(aviation, .25, { throttle: 1 });
  assert.ok(entity.x < 6100); assert.ok(entity.health < health);
  Object.assign(entity, { x: 5850, y: 4000, elevation: 40, speed: 1500, throttle: 1, angle: 0, health: entity.maxHealth, engineHealth: 100, burning: false });
  const remaining = entity.health;
  advance(aviation, .25, { throttle: 1 });
  assert.ok(entity.x > 6150); assert.equal(entity.health, remaining);
});

test('aircraft and road vehicles collide only when their elevations overlap', () => {
  const car = { id: 'car', kind: 'compact', x: 6100, y: 4000, elevation: 0, health: 100 };
  const { game, aviation } = fixture({ cars: [car] });
  const entity = aviation.spawn('trainer', { x: 5900, y: 4000, elevation: 30 });
  game.player.vehicleId = entity.id; entity.speed = 600; entity.throttle = 1;
  advance(aviation, .5, { throttle: 1 });
  assert.equal(car.health, 100);
  Object.assign(entity, { x: 5900, y: 4000, elevation: 0, grounded: true, speed: 600, angle: 0 });
  advance(aviation, .5, { throttle: 1, descend: true });
  assert.ok(car.health < 100); assert.ok(entity.health < entity.maxHealth);
});

test('NPC commuter boards, taxis, reserves, departs, arrives and parks without damage', () => {
  const { aviation, airport } = fixture();
  const entity = aviation.spawn('commuter', airport.stands[2], { npc: true, standId: airport.stands[2].id, departureDelay: 0 });
  const phases = new Set();
  for (let tick = 0; tick < 180 * 60; tick++) { aviation.step(1 / 60); phases.add(entity.flightPhase); }
  for (const phase of ['boarding', 'taxi', 'hold', 'takeoff', 'departure', 'turnaround', 'arrival', 'landing', 'taxi-in', 'parked']) assert.ok(phases.has(phase), phase);
  assert.equal(entity.health, entity.maxHealth);
});

test('an occupied runway holds departures and makes arrivals go around', () => {
  const blocker = { id: 'runway-car', kind: 'compact', x: 11060, y: 3400, elevation: 0, health: 100 };
  const { aviation, airport } = fixture({ cars: [blocker] });
  const entity = aviation.spawn('commuter', airport.stands[2], { npc: true });
  aviation._phase(entity, 'hold');
  advance(aviation, 2);
  assert.equal(entity.flightPhase, 'hold'); assert.equal(aviation.runwayReservation, null);
  Object.assign(entity, aviation.approach, { grounded: false, speed: 270, angle: aviation.heading });
  aviation._phase(entity, 'arrival');
  advance(aviation, .1);
  assert.equal(entity.flightPhase, 'go-around'); assert.equal(aviation.runwayReservation, null);
});

test('airport ground reservations prevent opposite taxi traffic and repeat cycles remain healthy', () => {
  const { aviation, airport } = fixture();
  const commuter = aviation.spawn('commuter', airport.stands[2], { npc: true, standId: airport.stands[2].id, departureDelay: 0 });
  const trainer = aviation.spawn('trainer', airport.stands[1], { npc: true, standId: airport.stands[1].id, departureDelay: 20 });
  let commuterReturns = 0, previous = commuter.flightPhase;
  for (let tick = 0; tick < 400 * 60; tick++) {
    aviation.step(1 / 60);
    if (commuter.flightPhase === 'parked' && previous !== 'parked') commuterReturns++;
    previous = commuter.flightPhase;
    const ground = aviation.aircraft.filter(entity => ['taxi', 'hold', 'takeoff', 'landing', 'taxi-in'].includes(entity.flightPhase));
    assert.ok(ground.length <= 1);
  }
  assert.ok(commuterReturns >= 2); assert.equal(commuter.health, commuter.maxHealth); assert.equal(trainer.health, trainer.maxHealth);
});

test('air patrol announces escalation, caps at one and searches only its last actual sighting', () => {
  let blocked = false;
  const { game, aviation, events } = fixture({ heat: 3, _blockedLine: () => blocked });
  const entity = aviation.spawn('policeheli', { x: 6500, y: 4000 });
  advance(aviation, 9);
  assert.ok(aviation.policeWarning > 0); assert.ok(events.some(event => event.text.includes('6 seconds')));
  advance(aviation, 6);
  assert.equal(aviation.aircraft.filter(aircraft => aircraft.aircraftType === 'policeheli').length, 1);
  assert.equal(entity.npc, true);
  Object.assign(entity, { x: 6500, y: 4000, elevation: 40, grounded: false });
  advance(aviation, .1);
  assert.equal(game.airPoliceSeen, true);
  const seen = { ...entity.lastSeen };
  blocked = true; game.player.x = 8000; game.player.y = 5500;
  advance(aviation, 2);
  assert.equal(game.airPoliceSeen, false); assert.equal(entity.flightPhase, 'search'); assert.deepEqual(entity.lastSeen, seen);
  advance(aviation, 29);
  assert.equal(entity.flightPhase, 'return');
});

test('the side gun has a limited right arc, visible bursts and cannot shoot through cover', () => {
  let blocked = false;
  const { aviation } = fixture({ _blockedLine: () => blocked });
  const entity = aviation.spawn('policeheli', { x: 6000, y: 4000, elevation: 30 });
  const target = { x: 6000, y: 4500, elevation: 0 };
  assert.equal(aviation._fire(entity, 0, target), false);
  assert.equal(aviation._fire(entity, Math.PI / 2, target), true);
  assert.equal(aviation.aircraftProjectiles.length, 1);
  const round = aviation.aircraftProjectiles[0];
  assert.ok(round.vy > 1000); assert.ok(round.vz < 0); assert.equal(round.elevation, round.height);
  assert.equal(aviation._fire(entity, Math.PI / 2, target), false);
  entity.gunCooldown = 0; blocked = true;
  assert.equal(aviation._fire(entity, Math.PI / 2, target), false);
  blocked = false; aviation.time = 1;
  assert.equal(aviation._fire(entity, Math.PI / 2, target), false, 'bursts have a cooldown gap');
});

test('recovery preserves stable identity, aircraft type and damage while choosing clear parking', () => {
  const { game, aviation, airport } = fixture();
  const entity = aviation.spawn('helicopter', { x: 6000, y: 4000, elevation: 50 });
  aviation.spawn('helicopter', airport.helipads[0]);
  game.player.vehicleId = entity.id;
  aviation.damage(entity, 35);
  const { id, aircraftType, health, engineHealth } = entity;
  assert.equal(aviation.recover(entity), true);
  assert.equal(entity.id, id); assert.equal(entity.aircraftType, aircraftType);
  assert.equal(entity.health, health); assert.equal(entity.engineHealth, engineHealth); assert.equal(aviation.current, entity);
  assert.equal(entity.grounded, true); assert.equal(entity.vz, 0);
  assert.ok(Math.hypot(entity.x - airport.helipads[0].x, entity.y - airport.helipads[0].y) > 200);
  assert.equal(game.player.elevation, entity.elevation);
});

test('parking checks whole footprints against people, cars, structures and occupied military stands', () => {
  const { game, aviation, airport } = fixture();
  const military = aviation.spawn('transportheli', airport.militaryStands[0]);
  assert.equal(aviation.clearPosition('transportheli', airport.militaryStands[0]), false);
  assert.equal(aviation.clearPosition('transportheli', airport.militaryStands[0], military), true);
  assert.deepEqual(aviation.parkingPosition('transportheli', military), { ...airport.militaryStands[0], elevation: 0 });
  const point = { x: 6000, y: 4000, angle: 0 };
  game.cars = [{ id: 'car', kind: 'compact', x: 6100, y: 4000, elevation: 0 }];
  assert.equal(aviation.clearPosition('fighter', point), false);
  game.cars = []; game.peds = [{ id: 'ped', x: 6000, y: 4100, elevation: 0 }];
  assert.equal(aviation.clearPosition('transportheli', point), false);
  game.peds = []; game.player.x = 1000;
  game.buildings = [{ x: 6080, y: 3900, w: 20, h: 200, elevation: 0, height: 10 }];
  assert.equal(aviation.clearPosition('fighter', point), false);
});

test('bailout keeps the real airborne position and velocity for the parachute system', () => {
  const { game, aviation } = fixture();
  const entity = aviation.spawn('trainer', { x: 6000, y: 4000, elevation: 60 });
  game.player.vehicleId = entity.id; entity.speed = entity.vx = 400; entity.vz = -3;
  assert.equal(aviation.bailOut(), true);
  assert.equal(game.player.vehicleId, null); assert.equal(game.player.parachuting, true);
  assert.equal(game.player.elevation, 61.5); assert.equal(game.player.vx, 400); assert.equal(game.player.verticalVelocity, -3);
  assert.equal(entity.flightPhase, 'abandoned'); assert.equal(entity.throttle, 0);
});

test('segment damage is swept in 3D and expanded airspace steers players home', () => {
  const { game, aviation } = fixture();
  const entity = aviation.spawn('trainer', { x: 6000, y: 4000, elevation: 30 });
  assert.equal(aviation.hitSegment({ x: 5700, y: 4000, elevation: 1 }, { x: 6300, y: 4000, elevation: 1 }), false);
  assert.equal(aviation.hitSegment({ x: 5700, y: 4000, elevation: 31 }, { x: 6300, y: 4000, elevation: 31 }, 10), true);
  assert.equal(entity.health, entity.maxHealth - 10);
  assert.equal(aviation.bounds.minX, -12000);
  game.player.vehicleId = entity.id; Object.assign(entity, { x: 24100, y: 1000, angle: 0, speed: 500, throttle: 1 });
  advance(aviation, 1, { throttle: 1 });
  assert.ok(Math.abs(entity.angle) > 1); assert.equal(entity.boundaryWarning, true);
});

test('hard landings record a mission collision, engine fires and explosion timestamps persist', () => {
  const { game, aviation } = fixture({ time: 47, missionStats: { collisions: 0 } });
  const entity = aviation.spawn('helicopter', { x: 6000, y: 4000, elevation: 1 });
  game.player.vehicleId = entity.id;
  entity.vz = -20; entity.engineHealth = 0;
  advance(aviation, .2);
  assert.equal(game.missionStats.collisions, 1);
  assert.ok(entity.health < entity.maxHealth); assert.equal(entity.burning, true);
  advance(aviation, 11);
  assert.equal(entity.exploded, true); assert.equal(entity.explosionTime, 47);
  assert.equal(entity.health, 0);
});

test('player cannon impacts report the actual ground incident and struck officers', () => {
  const incidents = [], cop = { id: 'cop', kind: 'compact', x: 6000, y: 4500, elevation: 0, angle: 0, health: 100 };
  const { aviation } = fixture({ police: [cop], _raiseHeat: (amount, reason, incident) => incidents.push({ amount, reason, incident }) });
  const entity = aviation.spawn('policeheli', { x: 6000, y: 4000, elevation: 30 });
  assert.equal(aviation._fire(entity, Math.PI / 2, cop), true);
  advance(aviation, .5);
  const impact = incidents.find(item => item.reason === 'Airborne cannon impact');
  assert.ok(impact); assert.deepEqual(impact.incident.officers, [cop]);
  assert.ok(impact.incident.position.elevation < 2); assert.ok(cop.health < 100);
});

test('neutral air taxis board, take off, cruise and land at both stops using the shared controller', () => {
  const { aviation } = fixture();
  const marina = { id: 'marina', x: 3000, y: 4700, elevation: 0 }, airport = { id: 'taxi-return', x: 10160, y: 4220, elevation: 0 };
  const entity = aviation.spawn('helicopter', marina, { npc: true, npcRole: 'air-taxi', routePads: [marina, airport], routeIndex: 1, flightPhase: 'boarding', phase: 'boarding' });
  const phases = new Set(), stops = new Set();
  for (let tick = 0; tick < 180 * 60; tick++) {
    aviation.step(1 / 60); phases.add(entity.flightPhase);
    if (entity.flightPhase === 'boarding') stops.add(entity.routeIndex);
  }
  for (const phase of ['boarding', 'vertical-takeoff', 'cruise', 'air-approach', 'vertical-landing']) assert.ok(phases.has(phase), phase);
  assert.equal(stops.size, 2); assert.equal(entity.health, entity.maxHealth);
});

test('parked unpiloted rotors stay still, pilots start them and powerless airborne rotors autorotate', () => {
  const { game, aviation } = fixture();
  const entity = aviation.spawn('helicopter', { x: 6000, y: 4000 });
  advance(aviation, 1);
  assert.equal(entity.rotorAngle, 0);
  board(game, aviation, entity);
  advance(aviation, .2, { climb: true });
  assert.ok(Math.abs(entity.rotorAngle) > .1);
  game.player.vehicleId = null; entity.npc = false; entity.engineHealth = 0;
  Object.assign(entity, { elevation: 40, grounded: false, rotorAngle: 0 });
  advance(aviation, .1);
  assert.ok(entity.rotorAngle > .3 && entity.rotorAngle < .5);
  Object.assign(entity, { elevation: 0, grounded: true, rotorAngle: 0, vz: 0 });
  advance(aviation, .1);
  assert.equal(entity.rotorAngle, 0);
});

test('saved aircraft use reserved storage instead of occupying the scheduled air taxi pad', () => {
  const { aviation, airport } = fixture();
  airport.helipads.forEach(pad => aviation.spawn(pad.aircraftType, pad));
  const storage = { id: 'storage-1', type: 'any', x: 10410, y: 5100, angle: 0 };
  airport.storageStands = [storage];
  const scheduled = { id: 'scheduled-taxi', aircraftType: 'helicopter', x: 10160, y: 4220, airTaxi: true, noSpawn: true };
  aviation.helipads.push(scheduled);
  assert.deepEqual(aviation.parkingPosition('helicopter'), { ...storage, elevation: 0 });
});
