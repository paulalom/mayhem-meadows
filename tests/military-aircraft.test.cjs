'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AircraftSystem, AIRCRAFT_TYPES } = require('../aircraft.js');
const { createMilitaryBase } = require('../military.js');
const { Game } = require('../core.js');

function fixture({ populate = false, cars = [], peds = [], buildings = [], militaryBase } = {}) {
  const civilian = {
    runways: [{ x: 10920, y: 2300, w: 280, h: 2200, thresholds: [{ id: 'north', x: 11060, y: 2440, angle: Math.PI / 2 }, { id: 'south', x: 11060, y: 4360, angle: -Math.PI / 2 }] }],
    departureThresholdId: 'south', taxiways: [{ x: 10700, y: 2480, w: 90, h: 2020 }], aprons: [{ x: 10370, y: 2850, w: 390, h: 1900 }],
    stands: [{ id: 'civil-commuter', aircraftType: 'commuter', x: 10530, y: 3670, angle: 0 }],
    helipads: [{ id: 'civil-heli', aircraftType: 'helicopter', x: 10495, y: 4360, angle: 0, radius: 110 }],
    militaryStands: [{ id: 'old-heavy', aircraftType: 'transportheli', x: 10580, y: 2110, angle: 0 }, { id: 'old-fighter', aircraftType: 'fighter', x: 10495, y: 2600, angle: -Math.PI / 2 }],
    taxiRoutes: [{ standId: 'civil-commuter', points: [{ x: 10745, y: 3670 }, { x: 10745, y: 4360 }, { x: 11060, y: 4360 }] }]
  };
  const military = militaryBase || {
    id: 'military', runways: [{ x: 2400, y: -3000, w: 6000, h: 300, thresholds: [{ id: 'west', x: 2540, y: -2850, angle: 0 }, { id: 'east', x: 8260, y: -2850, angle: Math.PI }] }],
    departureThresholdId: 'west', taxiways: [{ x: 2500, y: -2460, w: 5800, h: 120 }], aprons: [{ x: 3000, y: -2210, w: 2100, h: 750 }],
    stands: [{ id: 'base-fighter', aircraftType: 'fighter', x: 3500, y: -1850, angle: -Math.PI / 2, npc: true, departureDelay: 0 }],
    helipads: [{ id: 'base-heavy', aircraftType: 'transportheli', x: 4600, y: -1850, angle: -Math.PI / 2, radius: 170 }, { id: 'base-cargo-pad', x: 7000, y: -1850, angle: 0, radius: 170, noSpawn: true }],
    storageStands: [{ id: 'base-fighter-spare', aircraftType: 'fighter', x: 4000, y: -1850, angle: -Math.PI / 2 }],
    taxiRoutes: [{ standId: 'base-fighter', points: [{ x: 3500, y: -2400 }, { x: 2540, y: -2400 }, { x: 2540, y: -2850 }] }],
    arrivalTaxiRoutes: [{ standId: 'base-fighter', points: [{ x: 8185, y: -2850 }, { x: 8185, y: -2400 }, { x: 3500, y: -2400 }] }]
  };
  const game = {
    world: { mapWidth: 12000, mapHeight: 12000, groundBounds: { minX: 0, minY: -4000, maxX: 12000, maxY: 8000 }, landscape: { airport: civilian, militaryBase: military, airspace: { minX: -12000, minY: -12000, maxX: 24000, maxY: 20000 } } },
    player: { id: 'player', x: 6000, y: 4000, elevation: 0, angle: 0, grounded: true, vehicleId: null, composure: 100 },
    heat: 0, cars, police: [], peds, buildings, staticObjects: [], _ground: point => point.y < 0 ? military.elevation || 12 : 0,
    _blockedLine: () => false, _isFree: () => true, _toast: () => {}
  };
  const aviation = new AircraftSystem(game, { spawn: populate });
  game.aviation = aviation; game.aircraft = aviation.aircraft;
  Object.defineProperty(game, 'current', { get: () => aviation.current || game.player });
  return { game, aviation, civilian, military };
}

function advance(aviation, seconds, input = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) aviation.step(1 / 60, input);
}

function spawnPair(aviation, civilian, military) {
  return [
    aviation.spawn('commuter', civilian.stands[0], { npc: true, departureDelay: 0 }),
    aviation.spawn('fighter', military.stands[0], { npc: true, departureDelay: 0 })
  ];
}

test('military aircraft move to the remote base while the civilian fleet and air taxi metadata remain intact', () => {
  const { aviation, civilian, military } = fixture({ populate: true });
  const militaryAircraft = aviation.aircraft.filter(entity => ['fighter', 'transportheli'].includes(entity.aircraftType));
  assert.deepEqual(militaryAircraft.map(entity => entity.standId).sort(), ['base-fighter', 'base-heavy']);
  for (const entity of militaryAircraft) {
    assert.equal(entity.airportId, 'military'); assert.ok(entity.y < -1000); assert.equal(entity.elevation, 12);
    assert.ok(aviation.clearPosition(entity, entity, entity));
  }
  assert.equal(aviation.stands, civilian.stands); assert.equal(aviation.helipads, civilian.helipads);
  assert.equal(aviation.airports.military.airport, military);
  assert.equal(civilian.militaryStands.length, 2, 'visiting parking metadata is preserved');
  assert.equal(aviation.aircraft.find(entity => entity.aircraftType === 'commuter').airportId, 'civilian');
});

test('both airfields taxi and reserve their runways concurrently without sharing ground locks', () => {
  const { aviation, civilian, military } = fixture();
  const [commuter, fighter] = spawnPair(aviation, civilian, military);
  for (const entity of [commuter, fighter]) { aviation._phase(entity, 'boarding'); entity.phaseTime = 9; }
  aviation.step(1 / 60);
  assert.equal(commuter.flightPhase, 'taxi'); assert.equal(fighter.flightPhase, 'taxi');
  for (const entity of [commuter, fighter]) aviation._phase(entity, 'hold');
  aviation.step(1 / 60);
  assert.equal(commuter.flightPhase, 'takeoff'); assert.equal(fighter.flightPhase, 'takeoff');
  assert.equal(aviation.runwayReservation, commuter.id);
  assert.equal(aviation.airports.military.runwayReservation, fighter.id);
  assert.equal(aviation._groundTrafficClear(commuter), true);
  assert.equal(aviation._groundTrafficClear(fighter), true);
});

test('a military runway obstruction holds base departures and causes go-arounds without blocking the city runway', () => {
  const blocker = { id: 'base-truck', kind: 'van', x: 5100, y: -2850, elevation: 12 };
  const { aviation, civilian, military } = fixture({ cars: [blocker] });
  const [commuter, fighter] = spawnPair(aviation, civilian, military);
  for (const entity of [commuter, fighter]) aviation._phase(entity, 'hold');
  aviation.step(1 / 60);
  assert.equal(commuter.flightPhase, 'takeoff'); assert.equal(fighter.flightPhase, 'hold');
  assert.equal(aviation.runwayReservation, commuter.id); assert.equal(aviation.airports.military.runwayReservation, null);
  Object.assign(fighter, aviation.airports.military.approach, { angle: 0, speed: 450, grounded: false });
  aviation._phase(fighter, 'arrival'); aviation.step(1 / 60);
  assert.equal(fighter.flightPhase, 'go-around'); assert.equal(aviation.runwayReservation, commuter.id);
  blocker.elevation = 80;
  assert.equal(aviation._runwayFree(fighter), true, 'an overflight does not occupy the surface runway');
});

test('a rejected second base arrival cannot clear the first aircraft runway reservation', () => {
  const { aviation, military } = fixture();
  const first = aviation.spawn('fighter', military.stands[0], { npc: true });
  const second = aviation.spawn('fighter', military.storageStands[0], { npc: true });
  const field = aviation.airports.military;
  Object.assign(first, field.approach, { angle: field.heading, speed: 450, grounded: false });
  Object.assign(second, field.approach, { x: field.approach.x - 800, angle: field.heading, speed: 450, grounded: false });
  aviation._phase(first, 'arrival'); aviation._phase(second, 'arrival'); field.runwayReservation = first.id;
  aviation._npc(second, 1 / 60);
  assert.equal(second.flightPhase, 'go-around'); assert.equal(field.runwayReservation, first.id);
  assert.equal(aviation._runwayFree(first), true);
});

test('a runway incursion after clearance aborts a grounded takeoff and pedestrians also protect the runway', () => {
  const { game, aviation, military } = fixture();
  const fighter = aviation.spawn('fighter', military.stands[0], { npc: true });
  const field = aviation.airports.military;
  Object.assign(fighter, field.threshold, { grounded: true, speed: 180 });
  aviation._phase(fighter, 'takeoff'); field.runwayReservation = fighter.id;
  game.peds.push({ id: 'runway-worker', x: 5100, y: -2850, elevation: 12 });
  aviation.step(1 / 60);
  assert.equal(fighter.flightPhase, 'hold'); assert.equal(field.runwayReservation, null); assert.equal(fighter.throttle, 0);
  const blockedSpeed = fighter.speed;
  advance(aviation, 1);
  assert.ok(fighter.speed < blockedSpeed); assert.equal(fighter.flightPhase, 'hold');
  game.peds.length = 0;
  aviation.step(1 / 60);
  assert.equal(fighter.flightPhase, 'takeoff'); assert.equal(field.runwayReservation, fighter.id);
});

test('borrowing a base aircraft releases only its own clearance and recovery preserves ownership, location and damage', () => {
  const { game, aviation, civilian, military } = fixture();
  const [commuter, fighter] = spawnPair(aviation, civilian, military);
  aviation.runwayReservation = commuter.id; aviation.airports.military.runwayReservation = fighter.id;
  Object.assign(game.player, { x: fighter.x + 130, y: fighter.y, elevation: 12 });
  assert.equal(aviation.enterNearest(), true); assert.equal(aviation.current, fighter);
  assert.equal(fighter.npc, false); assert.equal(fighter.borrowed, true);
  assert.equal(aviation.runwayReservation, commuter.id); assert.equal(aviation.airports.military.runwayReservation, null);
  Object.assign(fighter, { x: 8000, y: 5000, elevation: 80, grounded: false, health: 170, engineHealth: 65 });
  assert.equal(aviation.recover(fighter), true);
  assert.equal(fighter.x, military.stands[0].x); assert.equal(fighter.y, military.stands[0].y); assert.equal(fighter.elevation, 12);
  assert.equal(fighter.airportId, 'military'); assert.equal(fighter.health, 170); assert.equal(fighter.engineHealth, 65);
  assert.equal(game.player.vehicleId, fighter.id); assert.equal(game.player.y, fighter.y);
  assert.equal(aviation.interact(), true); assert.equal(game.player.vehicleId, null); assert.equal(game.player.elevation, 12);
});

test('base recovery chooses remote storage around blocked stands and accepts only the extended ground bounds', () => {
  const { aviation, military } = fixture();
  const fighter = aviation.spawn('fighter', military.stands[0]);
  aviation.spawn('fighter', military.stands[0]);
  const position = aviation.parkingPosition('fighter', fighter);
  assert.equal(position.id, 'base-fighter-spare'); assert.ok(position.y < 0);
  assert.equal(aviation.clearPosition('fighter', { x: 5000, y: -3900, angle: Math.PI / 2 }), false, 'whole rotated fuselage stays inside north border');
  assert.equal(aviation.clearPosition('fighter', { x: 5000, y: -3800, angle: Math.PI / 2 }), true);
  assert.equal(aviation.clearPosition('fighter', { x: 5000, y: 8100 }), false, 'the extension does not add southern ground');
  assert.equal(aviation.findParking('fighter').id, 'base-fighter-spare');
});

test('the military transport remains local to base pads when NPC shuttle service is enabled', () => {
  const { aviation, military } = fixture();
  const heavy = aviation.spawn('transportheli', military.helipads[0], { npc: true, departureDelay: 0 });
  advance(aviation, .1);
  assert.equal(heavy.airportId, 'military');
  assert.ok(heavy.routePads.every(pad => pad.y < 0));
  assert.equal(heavy.routePads[1].id, 'base-cargo-pad');
});

test('explicit hangar retrieval selects the local airfield instead of teleporting to an aircraft home across town', () => {
  const { aviation, civilian, military } = fixture();
  const fighter = aviation.spawn('fighter', military.stands[0]);
  assert.equal(aviation.airportAt(military.stands[0]), 'military');
  assert.equal(aviation.airportAt(civilian.stands[0]), 'civilian');
  assert.equal(aviation.airportAt({ x: 6000, y: 4000 }), null);
  const civilParking = aviation.parkingPosition('fighter', fighter, 'civilian');
  assert.ok(civilParking.y > 0); assert.notEqual(civilParking.id, military.stands[0].id);
  const overflow = aviation.spawn('fighter', { x: 4900, y: -1900 });
  assert.equal(overflow.airportId, 'military', 'unnamed overflow apron positions retain base affinity');
});

test('city and military NPC flights complete independent takeoff, arrival and parking cycles without damage', () => {
  const { aviation, civilian, military } = fixture();
  const pair = spawnPair(aviation, civilian, military), phases = pair.map(() => new Set()), returns = [0, 0], previous = pair.map(entity => entity.flightPhase);
  let simultaneous = false;
  for (let tick = 0; tick < 420 * 60; tick++) {
    aviation.step(1 / 60);
    pair.forEach((entity, index) => {
      phases[index].add(entity.flightPhase);
      if (entity.flightPhase === 'parked' && previous[index] !== 'parked') returns[index]++;
      previous[index] = entity.flightPhase;
      assert.equal(entity.health, entity.maxHealth, entity.aircraftType + ' health');
      const field = aviation._field(entity);
      if (['taxi', 'hold', 'takeoff', 'landing', 'taxi-in'].includes(entity.flightPhase)) {
        const active = aviation.aircraft.filter(other => aviation._field(other) === field && ['taxi', 'hold', 'takeoff', 'landing', 'taxi-in'].includes(other.flightPhase));
        assert.equal(active.length, 1);
      }
    });
    simultaneous ||= Boolean(aviation.runwayReservation && aviation.airports.military.runwayReservation);
  }
  for (const [index, entity] of pair.entries()) {
    for (const phase of ['boarding', 'taxi', 'hold', 'takeoff', 'departure', 'turnaround', 'arrival', 'landing', 'taxi-in', 'parked']) assert.ok(phases[index].has(phase), entity.aircraftType + ' ' + phase);
    assert.ok(returns[index] >= 1, entity.aircraftType + ' completed return');
    assert.equal(AIRCRAFT_TYPES[entity.aircraftType].maxHealth, entity.health);
  }
  assert.equal(simultaneous, true);
});

test('the actual Northwatch layout keeps the scheduled fighter clear of hangars, stored aircraft and helicopter pads for repeat flight cycles', () => {
  const base = createMilitaryBase();
  const { aviation } = fixture({ populate: true, militaryBase: base, buildings: base.buildings });
  const fighter = aviation.aircraft.find(entity => entity.standId === base.stands[0].id), phases = new Set();
  let returns = 0, previous = fighter.flightPhase, groundChecks = 0;
  for (const entity of aviation.aircraft.filter(entity => entity.airportId === 'military')) {
    assert.ok(aviation.clearPosition(entity, entity, entity), entity.standId + ' parked clearance');
    assert.equal(entity.elevation, base.elevation);
  }
  for (let tick = 0; tick < 420 * 60; tick++) {
    aviation.step(1 / 60); phases.add(fighter.flightPhase);
    if (fighter.flightPhase === 'parked' && previous !== 'parked') returns++;
    previous = fighter.flightPhase;
    assert.equal(fighter.health, fighter.maxHealth, fighter.flightPhase + ' undamaged');
    if (fighter.grounded && tick % 6 === 0) {
      assert.ok(aviation.clearPosition(fighter, fighter, fighter), fighter.flightPhase + ' whole-airframe clearance at ' + fighter.x.toFixed(0) + ',' + fighter.y.toFixed(0));
      const paved = base.runways.concat(base.taxiways, base.aprons).some(pad => fighter.x >= pad.x - 40 && fighter.x <= pad.x + pad.w + 40 && fighter.y >= pad.y - 40 && fighter.y <= pad.y + pad.h + 40);
      assert.ok(paved, fighter.flightPhase + ' remains on prepared pavement at ' + fighter.x.toFixed(0) + ',' + fighter.y.toFixed(0)); groundChecks++;
    }
  }
  assert.ok(returns >= 2, 'two complete returns on the actual layout'); assert.ok(groundChecks > 500);
  for (const phase of ['taxi', 'takeoff', 'departure', 'arrival', 'landing', 'taxi-in', 'parked']) assert.ok(phases.has(phase), phase);
});

test('two Northwatch fighters can share the actual runway and taxiway without colliding or starving either stand', () => {
  const base = createMilitaryBase(); base.stands[1].npc = true; base.stands[1].departureDelay = 65;
  const { aviation } = fixture({ populate: true, militaryBase: base, buildings: base.buildings });
  const fighters = aviation.aircraft.filter(entity => entity.aircraftType === 'fighter'), returns = [0, 0], previous = fighters.map(entity => entity.flightPhase);
  for (let tick = 0; tick < 600 * 60; tick++) {
    aviation.step(1 / 60);
    fighters.forEach((entity, index) => {
      if (entity.flightPhase === 'parked' && previous[index] !== 'parked') returns[index]++;
      previous[index] = entity.flightPhase;
      assert.equal(entity.health, entity.maxHealth, entity.standId + ' stays undamaged');
      if (entity.grounded && tick % 12 === 0) assert.ok(aviation.clearPosition(entity, entity, entity), entity.standId + ' whole-airframe clearance');
    });
    const ground = fighters.filter(entity => ['taxi', 'hold', 'takeoff', 'landing', 'taxi-in'].includes(entity.flightPhase));
    assert.ok(ground.length <= 1, 'one ground movement per field');
  }
  for (const [index, entity] of fighters.entries()) assert.ok(returns[index] >= 1, entity.standId + ' completes a return');
});

test('the generated city terrain, buildings, perimeter fences and parked road fleet permit both Northwatch fighter cycles', () => {
  const game = new Game({ seed: 42 }), aviation = game.aviation, base = game.world.militaryBase;
  const fighters = game.aircraft.filter(entity => entity.aircraftType === 'fighter');
  assert.equal(fighters.length, 2);
  fighters[1].npc = true; fighters[1].departureDelay = 65;
  const previous = fighters.map(entity => entity.flightPhase), returns = [0, 0];
  for (const entity of game.aircraft.filter(entity => entity.airportId === 'military')) {
    assert.equal(entity.elevation, 14);
    assert.ok(aviation.clearPosition(entity, entity, entity), entity.standId + ' generated-world clearance');
  }
  assert.ok(game.staticObjects.some(object => object.kind === 'military-fence'));
  assert.equal(game.cars.filter(entity => entity.baseId === 'military').length, 2);
  for (let tick = 0; tick < 600 * 60; tick++) {
    aviation.step(1 / 60);
    fighters.forEach((entity, index) => {
      if (entity.flightPhase === 'parked' && previous[index] !== 'parked') returns[index]++;
      previous[index] = entity.flightPhase;
      assert.equal(entity.health, entity.maxHealth, entity.standId + ' generated-world cycle health');
      if (entity.grounded && tick % 60 === 0) {
        assert.ok(Math.abs(entity.elevation - 14) < .01, 'taxiing and landing stay on the graded 14 m airfield');
        assert.ok(aviation.clearPosition(entity, entity, entity), entity.standId + ' generated-world taxi clearance');
      }
    });
  }
  for (const [index, entity] of fighters.entries()) assert.ok(returns[index] >= 1, entity.standId + ' completes a generated-world return');
  assert.equal(base.elevation, 14);
});

test('the real base supports boarding, local hangar saves and reloads, repairs and recovery without a city teleport', () => {
  const game = new Game({ seed: 42 }), fighter = game.aircraft.find(entity => entity.aircraftType === 'fighter' && !entity.npc);
  Object.assign(game.player, { x: fighter.x + 130, y: fighter.y, elevation: fighter.elevation, vehicleId: null, grounded: true });
  assert.equal(game.interact(), true); assert.equal(game.current, fighter); assert.equal(game.hangarAvailable, true);
  fighter.health = 170; fighter.engineHealth = 65; fighter.handlingHealth = 75;
  assert.equal(game.hangarStore(), true);
  const hangarId = fighter.hangarId, saved = game.exportSave(), count = game.aircraft.length;
  assert.equal(game.hangarRetrieve(hangarId), true); assert.equal(game.current, fighter); assert.equal(game.aircraft.length, count);
  assert.equal(fighter.airportId, 'military'); assert.ok(fighter.y < -1000); assert.equal(fighter.elevation, 14);
  assert.equal(fighter.health, 170); assert.equal(fighter.engineHealth, 65);
  const copy = new Game({ seed: 42 }); assert.equal(copy.loadSave(saved), true);
  Object.assign(copy.player, { x: 3700, y: -2090, elevation: 14, grounded: true, vehicleId: null });
  assert.equal(copy.hangarAvailable, true); assert.equal(copy.hangarRetrieve(hangarId), true);
  const retrieved = copy.current;
  assert.equal(retrieved.airportId, 'military'); assert.ok(retrieved.y < -1000); assert.equal(retrieved.health, 170);
  assert.ok(copy.aviation.clearPosition(retrieved, retrieved, retrieved));
  copy.money = 75; assert.equal(copy.hangarRepair(hangarId), true); assert.equal(copy.money, 0); assert.equal(retrieved.health, retrieved.maxHealth);
  Object.assign(retrieved, { x: 10000, y: 5000, elevation: 80, grounded: false });
  assert.equal(copy.recover(), true); assert.equal(copy.current, retrieved); assert.ok(retrieved.y < -1000); assert.equal(retrieved.elevation, 14);
  assert.equal(copy.interact(), true); assert.equal(copy.player.vehicleId, null); assert.equal(copy.player.elevation, 14);
});
