'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../core.js');
const { NPC_RADIUS } = require('../physics.js');

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function fixture() {
  const game = new Game({ seed: 42 });
  // Keep the real Northwatch geometry and military actors. Civilian traffic,
  // aircraft and patrols have their own integration suites and would otherwise
  // damage the target while measuring a soldier's actual projectile.
  game.peds = game.peds.filter(person => person.soldier);
  game.cars = game.cars.filter(car => car.baseId === 'military');
  for (const car of game.cars) car.traffic = false;
  game.aircraft.length = 0;
  game.police = [];
  game._updatePolice = () => {};
  game.aviation.step = () => {};
  game.tankTraffic.step = () => {};
  game.railTraffic.step = () => {};
  game.graceTimer = 0;
  game.drainEvents();
  return game;
}
function place(game, x, y, angle = 0) {
  Object.assign(game.player, { x, y, angle, elevation: game._ground(x, y), grounded: true,
    vehicleId: null, verticalVelocity: 0, stunned: 0 });
  game.vehiclePhysics.sync();
}
function advance(game, seconds, input = {}) {
  for (let tick = 0; tick < Math.ceil(seconds * 60); tick++) game.update(1 / 60, input);
}
function assertClear(game, person) {
  assert.equal(game._personFree(person.x, person.y, NPC_RADIUS), true,
    'the soldier clears the actual buildings, fences and vehicle bodies');
  assert.equal(game._dry(person), true, 'the soldier stands on dry terrain');
  assert.ok(Math.abs(person.elevation - game._ground(person)) < .12,
    'the soldier follows the actual terrain surface');
}
function combatFixture() {
  const game = fixture(), guard = game.soldiers[0];
  game.soldiers.splice(1); game.peds = [guard];
  game.militaryTransport.step = () => {};
  Object.assign(guard, { x: 4000, y: -930, elevation: game._ground(4000, -930),
    homeX: 4000, homeY: -930, angle: Math.PI, aimAngle: Math.PI, pathId: null,
    nav: [], lastKnown: null, gunCooldown: .7 });
  place(game, 4400, -930); game.heat = 4;
  game.vehiclePhysics.sync();
  return { game, guard };
}
function enableComposureRecovery(game) {
  game._updatePolice = Game.prototype._updatePolice;
  game.police = Array.from({ length: 3 }, (_, index) => ({ id: 'remote-patrol-' + index,
    ...game._vehicleState('compact'), x: 10500 + index * 80, y: 6200,
    elevation: game._ground(10500 + index * 80, 6200), angle: 0, speed: 0, vx: 0, vy: 0,
    distracted: 999, route: [{ x: 10500 + index * 80, y: 6200 }], routeTimer: 999,
    lastSeen: { x: game.player.x, y: game.player.y } }));
  game.vehiclePhysics.sync();
}

test('actual Northwatch personnel become six peaceful physical guards and patrol at ground level', () => {
  const game = fixture(), guards = game.soldiers;
  assert.equal(guards.length, 6);
  assert.ok(guards.every(guard => game.peds.includes(guard) && guard.soldier));
  const before = guards.map(guard => ({ x: guard.x, y: guard.y }));
  advance(game, 2);
  assert.ok(guards.every((guard, index) => distance(guard, before[index]) > 4), 'every guard actually patrols or leaves an obstructed apron spawn');
  for (const guard of guards) assertClear(game, guard);
  assert.equal(game.heat, 0); assert.equal(game.player.composure, 100);
  assert.equal(game.soldierRounds.length, 0, 'ordinary presence does not provoke military fire');
});

test('actual guard rifles turn visibly, acquire an aim and fire bounded live bursts at a four-star player', () => {
  const { game, guard } = combatFixture();
  advance(game, .25);
  assert.ok(Math.abs(guard.aimAngle) > 2.5, 'the rifle cannot snap through a half turn in a quarter second');
  assert.equal(game.player.composure, 100); assert.equal(game.soldierRounds.length, 0);
  advance(game, 2.3);
  const shots = game.soldierTraffic.events.filter(event => event.type === 'fire');
  assert.ok(shots.length >= 3, 'the actual controller fires a complete three-round burst');
  assert.ok(shots[0].time > 1.5, 'turning and aiming provide a readable delay before the first shot');
  assert.ok(game.player.composure < 100 && game.player.composure >= 90,
    'real rounds reach the player while keeping the initial burst survivable');
  assert.ok(Math.abs(guard.aimAngle) < .01); assertClear(game, guard);
  game._clearHeat(); advance(game, 1);
  assert.equal(game.soldierRounds.length, 0);
  assert.equal(guard.soldierPhase, 'patrol', 'cleared heat returns a guard to normal duty');
});

test('real building, fence and parked-car cover stop soldier rounds; grace and airborne targets stay protected', () => {
  for (const cover of ['building', 'fence', 'car', 'grace', 'airborne']) {
    const { game, guard } = combatFixture();
    guard.aimAngle = 0;
    if (cover === 'building') game.buildings = game.buildings.concat({ id: 'soldier-test-cover', x: 4190, y: -1000,
      w: 20, h: 140, height: 4, elevation: 14, angle: 0 });
    if (cover === 'fence') game.staticObjects = game.staticObjects.concat({ id: 'soldier-test-fence', kind: 'fence', x: 4200,
      y: -930, elevation: 14, angle: 0, destructible: false,
      parts: [{ offset: [0, 1.2, 0], half: [.12, 1.2, 3.5] }] });
    if (cover === 'car') game._addCar(4200, -930, Math.PI / 2, 'van', '#ffd15b');
    if (cover === 'grace') game.graceTimer = 10;
    if (cover === 'airborne') Object.assign(game.player, { elevation: 20, grounded: false, verticalVelocity: 0 });
    game.vehiclePhysics.sync();
    if (cover === 'airborne') {
      // A stable airborne craft exercises the actual target classifier without
      // allowing the unrelated walking controller to land a foot fixture.
      const craft = game.aviation.spawn('helicopter', { x: 4400, y: -930, elevation: 45, angle: 0 }, { borrowed: true });
      craft.grounded = false; game.player.vehicleId = craft.id;
    }
    advance(game, 3);
    assert.equal(game.player.composure, 100, cover + ' protects the on-foot target');
    assert.equal(game.soldierTraffic.events.some(event => event.type === 'hit-player' || event.type === 'hit-vehicle'), false,
      cover + ' prevents military infantry damage');
    assert.equal(game.soldierRounds.length, 0, cover + ' prevents shooting without a valid line of fire');
  }
});

test('infantry rounds hit an occupied physical vehicle without hurting its passenger or inventing a base attack', () => {
  const { game, guard } = combatFixture(), utility = game.cars[0];
  guard.aimAngle = 0;
  Object.assign(utility, { x: 4400, y: -930, angle: Math.PI / 2, elevation: 14,
    speed: 0, vx: 0, vy: 0, traffic: false });
  game.player.vehicleId = utility.id; game.vehiclePhysics.reset(utility);
  const health = utility.health; advance(game, 2);
  assert.ok(utility.health < health, 'live rifle rounds strike the Cannon vehicle hull');
  assert.equal(game.player.composure, 100, 'the occupied vehicle shields its passenger');
  assert.equal(game.tankTraffic.baseAlarmTime, 0, 'NPC rifle damage on a borrowed base utility is not a player base attack');
  assert.equal(game.soldierTraffic.alarm, 0);
  assert.ok(game.soldierTraffic.events.some(event => event.type === 'hit-vehicle' && event.id === utility.id));
});

test('real police-update composure recovery cannot erase rifle pressure and resumes after the player reaches cover', () => {
  const { game, guard } = combatFixture(); guard.aimAngle = 0;
  enableComposureRecovery(game); advance(game, 6);
  assert.ok(game.player.composure < 90, 'repeated real bursts reduce composure across the reload interval');
  assert.ok(Number.isFinite(game.player.lastIncomingFireAt), 'the actual impact records the recovery delay');
  game.staticObjects = game.staticObjects.concat({ id: 'recovery-cover', kind: 'fence', x: 4200,
    y: -930, elevation: 14, angle: 0, destructible: false,
    parts: [{ offset: [0, 1.2, 0], half: [.12, 1.2, 3.5] }] });
  game.vehiclePhysics.sync(); advance(game, .25);
  const sheltered = game.player.composure; advance(game, 2);
  assert.ok(Math.abs(game.player.composure - sheltered) < .02, 'the recovery delay remains active after the last hit');
  advance(game, 2);
  assert.ok(game.player.composure > sheltered + 3, 'sustained physical cover allows composure to recover');
});

test('incoming rifle bursts suppress recovery even when the player dodges every round', () => {
  const { game, guard } = combatFixture(); guard.aimAngle = 0;
  enableComposureRecovery(game); game.player.composure = 50;
  let shots = 0;
  for (let tick = 0; tick < 6 * 60; tick++) {
    const before = game.player.composure;
    game.update(1 / 60);
    const fired = game.soldierTraffic.events.filter(event => event.type === 'fire').length;
    if (fired > 0) assert.ok(game.player.composure <= before + 1e-8,
      'composure cannot rise during incoming fire or the pauses between bursts');
    if (fired > shots) place(game, 4400, game.player.y < -910 ? -890 : -930);
    shots = fired;
  }
  assert.ok(shots >= 6, 'the actual guard fires repeated live bursts');
  assert.equal(game.soldierTraffic.events.some(event => event.type === 'hit-player'), false,
    'every live round misses the dodging player');
  game.staticObjects = game.staticObjects.concat({ id: 'dodging-cover', kind: 'fence', x: 4200,
    y: -930, elevation: 14, angle: 0, destructible: false,
    parts: [{ offset: [0, 1.2, 0], half: [.12, 1.2, 3.5] }] });
  game.vehiclePhysics.sync();
  const sheltered = game.player.composure;
  advance(game, 4);
  assert.equal(game.soldierTraffic.events.filter(event => event.type === 'fire').length, shots,
    'solid cover stops aimed fire');
  assert.ok(game.player.composure > sheltered, 'recovery resumes safely behind cover');
});

test('actual toy hits disable a base guard, report the base attack and let the articulated body recover', () => {
  const game = fixture(), guard = game.soldiers[0];
  game.militaryTransport.step = () => {};
  place(game, guard.x - 40, guard.y);
  assert.equal(game.action(0, { pitch: 0 }), true);
  assert.ok(game.ragdolls.get(guard.id), 'the guard uses the existing articulated ragdoll');
  assert.equal(game.heat, 4, 'a real strike on a base defender raises the military alarm');
  assert.ok(game.soldierTraffic.alarm > 0 && game.militaryTransport.alarmTime > 0,
    'the same physical base attack alerts defenders and troop transports');
  const shotCount = game.soldierTraffic.events.filter(event => event.type === 'fire' && event.id === guard.id).length;
  advance(game, .5);
  assert.equal(game.soldierTraffic.events.filter(event => event.type === 'fire' && event.id === guard.id).length, shotCount,
    'a tumbling soldier cannot aim or fire');
  place(game, 7000, 1500); game._clearHeat(); advance(game, 6);
  assert.equal(game.ragdolls.get(guard.id), undefined, 'the physical guard gets back up');
  assert.equal(guard.stunned, 0); assertClear(game, guard);
  assert.equal(game.heat, 0, 'a recovering soldier does not create a civilian witness report');
});

test('physical car impacts tumble soldiers and only the player driver is responsible for the base attack', () => {
  for (const playerDriven of [true, false]) {
    const game = fixture(), guard = game.soldiers[0];
    game.militaryTransport.step = () => {};
    Object.assign(guard, { x: 4000, y: -930, elevation: 14, homeX: 4000, homeY: -930,
      pathId: null, pace: 0, nav: [] });
    const car = game._addCar(3860, -930, 0, 'van', '#ffd15b');
    Object.assign(car, { speed: 210, vx: 210, vy: 0 });
    place(game, 7000, 1500);
    if (playerDriven) game.player.vehicleId = car.id;
    game.vehiclePhysics.sync(); advance(game, .8, playerDriven ? { up: true } : {});
    assert.ok(game.ragdolls.get(guard.id), 'the moving van physically strikes the standing soldier');
    assert.equal(game.heat, playerDriven ? 4 : 0,
      playerDriven ? 'running over a defender reports the base attack' : 'an NPC collision does not accuse the player');
    assert.equal(game.soldierTraffic.events.some(event => event.type === 'fire' && event.id === guard.id), false,
      'the impacted soldier cannot keep firing while tumbling');
  }
});

test('infantry actually navigate around a physical parked van without clipping its body or the terrain', () => {
  const { game, guard } = combatFixture();
  guard.aimAngle = 0; place(game, 4600, -930);
  const obstruction = game._addCar(4200, -930, Math.PI / 2, 'van', '#67d3c8');
  game.vehiclePhysics.sync();
  game.soldierTraffic.reportBaseAttack({ playerCaused: true, position: game.player });
  const start = { x: guard.x, y: guard.y }; let detour = 0;
  for (let tick = 0; tick < 8 * 60; tick++) {
    game.update(1 / 60); detour = Math.max(detour, Math.abs(guard.y - start.y));
    assert.equal(game._personVehicleContact(guard, obstruction), null,
      'the moving soldier clears the actual parked chassis');
    assertClear(game, guard);
  }
  assert.ok(distance(guard, start) > 70, 'the soldier physically advances toward the reported incident');
  assert.ok(detour > 25, 'the soldier walks around the obstruction instead of pushing through it');
  assert.ok(game.soldierTraffic.events.some(event => event.type === 'fire'),
    'the soldier can acquire and fire again after clearing the obstruction');
});

test('four stars give a six-second carrier warning; real passengers ride without standing-body contacts', () => {
  const game = fixture(); place(game, 5550, 1150); game.heat = 4;
  game._reportedLocation = { x: 5550, y: 1150 };
  advance(game, 3);
  assert.equal(game.militaryTrucks.length, 0); assert.ok(game.militaryTransport.warning > 2.9);
  const warning = game.militaryTransport.warning;
  game.update(0); game.update(NaN); assert.equal(game.militaryTransport.warning, warning, 'pausing freezes mobilisation');
  game.heat = 3; game.update(1 / 60);
  assert.equal(game.militaryTransport.warning, 0, 'dropping below four stars cancels an incomplete warning');
  game.heat = 4; advance(game, 6.2);
  assert.equal(game.militaryTrucks.length, 1);
  const truck = game.militaryTrucks[0], riders = game.soldiers.filter(soldier => soldier.truckId === truck.id);
  assert.equal(riders.length, 4); assert.ok(game.cars.includes(truck));
  assert.equal(truck.kind, 'truck'); assert.equal(truck.modelId, 'northwatch-carrier');
  assert.ok(riders.every(rider => rider.transportedBy === truck.id));
  assert.ok(riders.every(rider => !game._standingPeople().includes(rider)), 'riders are excluded from standing contacts');
  game._vehiclePeople(truck, 180, 0);
  assert.ok(riders.every(rider => !game.ragdolls.get(rider.id)), 'their own moving chassis cannot run over its passengers');
  assert.ok(riders.every(rider => Math.abs(rider.elevation - truck.elevation - .52) < .1), 'passengers occupy the actual cargo-bed seats');
  const initial = { x: truck.x, y: truck.y };
  advance(game, 1);
  assert.ok(distance(truck, initial) > 15, 'the actual Game update drives the carrier through Cannon');
  assert.ok(riders.every(rider => !game.ragdolls.get(rider.id) && rider.stunned === 0));
  game._clearHeat();
  assert.ok(['return', 'reboard'].includes(truck.truckPhase));
  assert.equal(game.soldierRounds.length, 0);
});

test('actual carrier physics drives the base gate and ridge, unloads safely, reboards and returns without collisions', () => {
  const game = fixture(); place(game, 5550, 1150); game.heat = 4;
  game._reportedLocation = { x: 5550, y: 1150 };
  const truck = game.militaryTransport._dispatch();
  assert.ok(truck, 'the carrier has a clear physical motor-pool dispatch point');
  game.vehiclePhysics.sync();
  const roads = new Set(); let previous = { x: truck.x, y: truck.y }, travelled = 0;
  for (let tick = 0; tick < 120 * 60; tick++) {
    // Exercise the production route controller and actual chassis. The squad
    // starts combat only after its physical unloading has been measured.
    game.militaryTransport.step(1 / 60); game.vehiclePhysics.step(1 / 60);
    game.militaryTransport.syncPassengers();
    const movement = distance(truck, previous); travelled += movement; previous = { x: truck.x, y: truck.y };
    assert.ok(movement < 5, 'the carrier follows bounded physical steps without teleporting');
    const road = game.network.nearestRoad(truck); roads.add(road.roadId);
    assert.ok(game.militaryTransport.roadIds.has(road.roadId), 'the carrier stays on its approved road graph');
    assert.ok(road.distance < 65, 'the carrier stays on the road through bends');
    const deployed = game.soldiers.filter(soldier => soldier.truckId === truck.id && !soldier.transportedBy);
    for (const soldier of deployed) { assertClear(game, soldier); assert.ok(Math.abs(truck.speed) < 8); }
    if (deployed.length === 4) break;
  }
  assert.ok(travelled > 2500, 'the full physical trip leaves Northwatch and descends the ridge');
  assert.ok(roads.has('base-entry-road') && roads.has('base-gate-road') && roads.has('base-access-ridge'));
  assert.equal(truck.health, truck.maxHealth, 'the normal route has no self-inflicted collisions');
  assert.equal(truck.truckPhase, 'deployed'); assert.ok(distance(truck, game.player) < 600);
  const squad = game.soldiers.filter(soldier => soldier.truckId === truck.id);
  assert.equal(squad.length, 4); assert.ok(squad.every(soldier => !soldier.transportedBy));
  for (let a = 0; a < squad.length; a++) for (let b = a + 1; b < squad.length; b++)
    assert.ok(distance(squad[a], squad[b]) >= NPC_RADIUS * 2, 'unloaded squad members do not overlap');

  game._clearHeat();
  let reboarded = false;
  for (let tick = 0; tick < 160 * 60 && truck.truckPhase !== 'parked'; tick++) {
    game.militaryTransport.step(1 / 60);
    if (squad.some(soldier => !soldier.transportedBy)) game.soldierTraffic.step(1 / 60);
    game.vehiclePhysics.step(1 / 60); game.militaryTransport.syncPassengers();
    reboarded ||= squad.every(soldier => soldier.transportedBy === truck.id);
    const movement = distance(truck, previous); previous = { x: truck.x, y: truck.y };
    const road = game.network.nearestRoad(truck);
    assert.ok(movement < 5, 'the return trip also uses bounded chassis movement');
    assert.ok(road.distance < 65,
      'the returning carrier stays on the road: ' + JSON.stringify({ x: truck.x, y: truck.y, angle: truck.angle,
        speed: truck.speed, phase: truck.truckPhase, road: road.roadId, distance: road.distance, time: tick / 60 }));
  }
  assert.equal(reboarded, true, 'the actual deployed squad physically reboards before departure');
  assert.equal(truck.truckPhase, 'parked', 'the carrier negotiates the reverse hairpins and returns to base');
  assert.equal(truck.troopAI, false); assert.ok(distance(truck, truck.home) < 90);
  assert.equal(truck.health, truck.maxHealth, 'the return route also avoids self-inflicted collisions');
});

test('a real carrier can be commandeered and driven without AI takeover, then lets wrecked passengers exit clear doors', () => {
  const game = fixture(); place(game, 5550, 1150); game.heat = 4;
  const truck = game.militaryTransport._dispatch(); game.vehiclePhysics.sync();
  const riders = game.soldiers.filter(soldier => soldier.truckId === truck.id);
  place(game, truck.x - 95, truck.y - 13);
  assert.equal(game.action(0, { pitch: 0 }), true);
  assert.ok(riders.every(rider => !game.ragdolls.get(rider.id) && rider.stunned === 0),
    'a real close toy burst cannot strike protected passengers through the truck body');
  place(game, truck.x, truck.y + 65);
  assert.equal(game.interact(), true); assert.equal(game.current, truck);
  game._clearHeat(); advance(game, 1.6);
  assert.equal(truck.troopAI, false); assert.equal(truck.truckPhase, 'borrowed');
  const start = { x: truck.x, y: truck.y };
  advance(game, 2, { up: true });
  assert.ok(distance(truck, start) > 70, 'normal driving controls move the physical military carrier');
  assert.equal(truck.maxHealth, 240);
  Object.assign(truck, { speed: 0, vx: 0, vy: 0 }); game.vehiclePhysics.reset(truck);
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null);
  assert.equal(game._personFree(game.player.x, game.player.y), true);
  const parked = { x: truck.x, y: truck.y }; advance(game, .5);
  assert.equal(truck.troopAI, false); assert.ok(distance(truck, parked) < .1, 'the AI does not reclaim the borrowed carrier after exit');

  // A separate dispatched carrier still has its full crew aboard when its
  // physical hull is disabled, so emergency exit safety is tested directly.
  place(game, 5550, 1150); game.heat = 4;
  const wreck = game.militaryTransport._dispatch(); assert.ok(wreck);
  place(game, wreck.x, wreck.y + 150);
  game.vehiclePhysics.sync(); game._damageVehicle(wreck, 1000, { playerCaused: false });
  advance(game, 2);
  assert.equal(wreck.truckPhase, 'wreck'); assert.equal(wreck.troopAI, false);
  const survivors = game.soldiers.filter(soldier => soldier.truckId === wreck.id);
  assert.equal(survivors.length, 4); assert.ok(survivors.every(soldier => !soldier.transportedBy));
  for (const soldier of survivors) { assertClear(game, soldier); assert.equal(game.ragdolls.get(soldier.id), undefined); }
});

test('carrier repairs and recovery preserve its 240-point hull and exclude military transports from civilian garages and saves', () => {
  const game = fixture(); place(game, 5550, 1150);
  const truck = game.militaryTransport._dispatch(); game.vehiclePhysics.sync();
  place(game, truck.x, truck.y + 65); assert.equal(game.interact(), true);
  game.militaryTransport.step(1 / 60);
  Object.assign(truck, { health: 160, engineHealth: 65, handlingHealth: 60 });
  assert.equal(game.usePocket('repairTape'), true);
  assert.equal(truck.health, 215); assert.equal(truck.maxHealth, 240);
  assert.equal(truck.engineHealth, 100); assert.equal(truck.handlingHealth, 100);
  Object.assign(truck, { health: 190, engineHealth: 73, handlingHealth: 82, upright: false, elevation: 30 });
  assert.equal(game.recover(), true); assert.equal(game.current, truck); assert.equal(truck.upright, true);
  assert.equal(truck.health, 190); assert.equal(truck.maxHealth, 240);
  assert.equal(truck.engineHealth, 73); assert.equal(truck.handlingHealth, 82);
  assert.ok(game.militaryTransport.roadIds.has(game.network.nearestRoad(truck).roadId));
  assert.equal(game._vehicleFree(truck), true);
  const garage = game.services.find(service => service.id === 'garage');
  Object.assign(truck, { x: garage.x, y: garage.y, elevation: game._ground(garage), speed: 0, vx: 0, vy: 0 });
  game.vehiclePhysics.reset(truck); game.money = 1000;
  assert.equal(game.garageAvailable, true); assert.equal(game.garageStore(), false);
  assert.equal(game.purchase('repair'), true); assert.equal(truck.health, 240);
  assert.equal(game.purchase('armor'), true); assert.equal(truck.health, 240); assert.equal(truck.maxHealth, 240);
  const save = game.exportSave();
  save.garage.cars = [{ id: 'ride-1', kind: 'truck', modelId: 'northwatch-carrier', color: '#ffd15b', health: 240 }];
  assert.equal(game.loadSave(save), true); assert.equal(game.garage.cars.length, 0);
});
