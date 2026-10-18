'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AircraftSystem } = require('../aircraft.js');
const { createMilitaryBase } = require('../military.js');
const { Game } = require('../core.js');

function fixture({ populate = true, base = createMilitaryBase() } = {}) {
  const events = [], car = { id: 'car', kind: 'compact', modelId: 'bramble-pocket-rocket', x: 6000, y: 1500, elevation: 0, angle: 0, vx: 0, vy: 0, health: 1000 };
  const game = { world: { bounds: { minX: 0, minY: -4000, maxX: 12000, maxY: 8000 }, landscape: { militaryBase: base } },
    player: { id: 'player', x: car.x, y: car.y, elevation: 0, vehicleId: car.id, composure: 100 }, cars: [car], police: [], peds: [], buildings: base?.buildings || [], staticObjects: [], heat: 0,
    _ground: point => point.y < 0 ? 14 : 0, _blockedLine: () => false, _toast: text => events.push(text), _damageVehicle: (entity, amount) => { entity.health -= amount; } };
  const aviation = new AircraftSystem(game, { spawn: populate });
  Object.defineProperty(game, 'current', { get: () => aviation.current || game.cars.find(entity => entity.id === game.player.vehicleId) || game.player });
  game.aviation = aviation; game.aircraft = aviation.aircraft;
  aviation._policeCooldown = aviation._newsCooldown = 10000;
  return { aviation, game, car, base, events };
}
const advance = (aviation, seconds, input = {}) => { for (let i = 0; i < Math.round(seconds * 60); i++) aviation.step(1 / 60, input); };
const incident = mode => ({ x: 6000, y: 1500, elevation: mode === 'air' ? 90 : 0, mode });
function targetAircraft(aviation, game, type = 'helicopter') {
  const target = aviation.spawn(type, { x: 7000, y: 1000, elevation: 90 }, { borrowed: true });
  game.player.vehicleId = target.id; return target;
}
function round(aviation, from, to, options = {}) {
  aviation.aircraftProjectiles.push({ id: 'test-round', x: from.x, y: from.y, elevation: from.elevation, vx: to.x - from.x, vy: to.y - from.y, vz: to.elevation - from.elevation, life: 2, npc: true, ownerId: 'test-owner', damage: 8, ...options });
  aviation._projectiles(1);
}

test('fourth star warns, launches the appropriate real Northwatch airframe, and caps responses at one', () => {
  for (const mode of ['air', 'ground']) {
    const { aviation, game, events } = fixture();
    if (mode === 'air') targetAircraft(aviation, game);
    game.heat = 3; advance(aviation, 20); assert.equal(aviation.militaryResponse, null);
    game.heat = 4; advance(aviation, 6);
    assert.ok(aviation.militaryWarning > 6); assert.equal(aviation.militaryResponse, null);
    advance(aviation, 7.1);
    const response = aviation.militaryResponse;
    assert.equal(response.aircraftType, mode === 'air' ? 'fighter' : 'transportheli');
    assert.equal(response.airportId, 'military'); assert.ok(response.y < -1000); assert.equal(response.home.elevation || aviation._ground(response.home), 14); assert.ok(response.elevation >= 14 && response.elevation < 15);
    assert.equal(response.militaryUnit, true); assert.equal(response.responseRole, 'military');
    assert.ok(events.some(text => /Northwatch/.test(text)));
    advance(aviation, 20);
    assert.equal(aviation.aircraft.filter(entity => entity.militaryResponse).length, 1);
    assert.equal(aviation.militaryStatus.type, mode === 'air' ? 'jet' : 'helicopter');
  }
});

test('warnings cancel when heat clears, the player dismounts, or the vehicle class changes', () => {
  for (const change of ['heat', 'foot', 'air']) {
    const { aviation, game } = fixture(); game.heat = 4; advance(aviation, 6);
    if (change === 'heat') game.heat = 0;
    else if (change === 'foot') game.player.vehicleId = null;
    else targetAircraft(aviation, game);
    advance(aviation, .1); assert.equal(aviation.militaryWarning, 0); assert.equal(aviation.militaryResponse, null);
  }
  const { aviation, game } = fixture({ base: null }); game.heat = 4; advance(aviation, 30);
  assert.equal(aviation.militaryResponse, null, 'legacy maps without Northwatch do not spawn a pursuer beside the player');
});

test('dispatch protects scheduled and borrowed aircraft, and replacement reserves remain bounded', () => {
  const { aviation, game, base } = fixture();
  const scheduled = aviation.aircraft.find(entity => entity.aircraftType === 'fighter' && entity.npc), borrowed = aviation.aircraft.find(entity => entity.aircraftType === 'fighter' && !entity.npc);
  borrowed.borrowed = true; targetAircraft(aviation, game);
  const response = aviation._launchMilitary(incident('air'));
  assert.notEqual(response, scheduled); assert.notEqual(response, borrowed); assert.equal(response.militaryReserve, true);
  assert.equal(response.elevation, 14); assert.ok(response.y < 0);
  const count = aviation.aircraft.length;
  response.health = 0; aviation._finishMilitary(response);
  assert.equal(aviation._launchMilitary(incident('air')), null, 'a destroyed reserve waits for its replacement cooldown');
  aviation.time += 100;
  const replacement = aviation._launchMilitary(incident('air'));
  assert.ok(replacement); assert.notEqual(replacement, response); assert.equal(aviation.aircraft.length, count);
  assert.equal(aviation.aircraft.filter(entity => entity.militaryReserve && !entity.borrowed).length, 1);
  aviation._finishMilitary(replacement);
  Object.assign(game.player, { vehicleId: null, x: base.storageStands[0].x, y: base.storageStands[0].y });
  borrowed.borrowed = true; replacement.borrowed = true;
  assert.equal(aviation._launchMilitary(incident('air')), null, 'new reserves never pop into a nearby player view');
});

test('military sight follows cover, searches the last actual sighting, and holds fire on foot', () => {
  const { aviation, game, car } = fixture(); game.heat = 4;
  const response = aviation._launchMilitary(incident('ground'));
  Object.assign(response, { x: car.x + 650, y: car.y, elevation: 50, grounded: false, angle: Math.PI / 2 });
  aviation._phase(response, 'military-intercept');
  aviation._militaryDuty(response, 5); assert.equal(game.airPoliceSeen, true);
  const lastSeen = { ...response.lastSeen };
  game._blockedLine = () => true; car.x += 1500;
  const command = aviation._militaryDuty(response, 1);
  assert.deepEqual(response.lastSeen, lastSeen); assert.equal(response.flightPhase, 'military-search'); assert.notEqual(command.fire, true);
  game.player.vehicleId = null; game._blockedLine = () => false;
  const foot = aviation._militaryDuty(response, 1);
  assert.equal(foot.fire, undefined); assert.deepEqual(response.lastSeen, lastSeen);
  aviation._militaryDuty(response, 31); assert.equal(response.flightPhase, 'military-return');
});

test('changing ground and air targets recalls the existing aircraft before another unit can launch', () => {
  const { aviation, game } = fixture(); game.heat = 4;
  const response = aviation._launchMilitary(incident('ground'));
  Object.assign(response, { elevation: 50, grounded: false }); aviation._phase(response, 'military-intercept');
  targetAircraft(aviation, game); aviation._militaryDuty(response, 1 / 60);
  assert.equal(response.flightPhase, 'military-return'); assert.equal(aviation._launchMilitary(incident('air')), null);
  assert.equal(aviation.aircraft.filter(entity => entity.militaryResponse).length, 1);
});

test('the fighter gun fires only forward, damages actual player aircraft, and respects swept cover', () => {
  const { aviation, game } = fixture({ populate: false });
  const target = targetAircraft(aviation, game), response = aviation.spawn('fighter', { x: 5800, y: 1000, elevation: 90 }, { militaryResponse: true, militaryRole: 'interceptor', npc: true });
  assert.equal(aviation._fireForward(response, target), true);
  for (let i = 0; i < 60; i++) aviation._projectiles(1 / 60);
  assert.equal(target.health, target.maxHealth - 8);
  response.gunCooldown = 0; response.angle = Math.PI / 2;
  assert.equal(aviation._fireForward(response, target), false);
  response.angle = 0; game.buildings.push({ x: 6300, y: 950, w: 20, h: 100, elevation: 0, height: 110 });
  assert.equal(aviation._fireForward(response, target), false);
  const health = target.health;
  round(aviation, { x: 6000, y: 1000, elevation: 91 }, { x: 7400, y: 1000, elevation: 91 });
  assert.equal(target.health, health, 'thin cover wins before an aircraft at the end of a long sweep');
});

test('gunship rounds reach real car bodies from the authored side muzzle and stop at roofs, fences and ridges', () => {
  const { aviation, game, car } = fixture({ populate: false });
  const response = aviation.spawn('transportheli', { x: car.x, y: car.y - 650, elevation: 45 }, { militaryResponse: true, militaryRole: 'gunship', npc: true });
  assert.equal(aviation._fire(response, Math.PI / 2, car), true);
  for (let i = 0; i < 60; i++) aviation._projectiles(1 / 60);
  assert.equal(car.health, 995);
  const before = car.health;
  round(aviation, { x: car.x + 20, y: car.y - 100, elevation: .65 }, { x: car.x + 20, y: car.y + 100, elevation: .65 });
  assert.equal(car.health, before - 8, 'a compact nose uses its physical 46-unit length');
  round(aviation, { x: car.x, y: car.y - 100, elevation: 1.5 }, { x: car.x, y: car.y + 100, elevation: 1.5 });
  assert.equal(car.health, before - 8, 'a round above the 1.3 m roof passes over');
  game.staticObjects.push({ x: car.x, y: car.y - 50, elevation: 0, parts: [{ offset: [0, 1, 0], half: [2, 1, .1] }] });
  round(aviation, { x: car.x, y: car.y - 100, elevation: .65 }, { x: car.x, y: car.y + 100, elevation: .65 });
  assert.equal(car.health, before - 8);
  game.staticObjects.length = 0;
  game._ground = point => point.y > car.y - 60 && point.y < car.y - 30 ? 2 : 0;
  round(aviation, { x: car.x, y: car.y - 100, elevation: .65 }, { x: car.x, y: car.y + 100, elevation: .65 });
  assert.equal(car.health, before - 8, 'a ridge between clear endpoints blocks the swept round');
});

test('swept rounds damage only the first physical target, even when the candidate array is reversed', () => {
  const { aviation, game, car } = fixture({ populate: false });
  const front = { ...car, id: 'front', y: car.y - 50 }, behind = { ...car, id: 'behind', y: car.y + 50 };
  game.cars = [behind, front]; game.player.vehicleId = behind.id;
  round(aviation, { x: car.x, y: car.y - 100, elevation: .65 }, { x: car.x, y: car.y + 100, elevation: .65 });
  assert.equal(front.health, 992); assert.equal(behind.health, 1000);
});

test('actual fighter hits destroy a piloted aircraft, trigger its engine fire and bailout, then stop attacks on foot', () => {
  const game = new Game({ seed: 42 }), aviation = game.aviation;
  const target = aviation.spawn('helicopter', { x: 7000, y: 1000, elevation: 200 }, { borrowed: true });
  game.player.vehicleId = target.id; game.heat = 4;
  const response = aviation._launchMilitary({ x: target.x, y: target.y, elevation: target.elevation, mode: 'air' });
  Object.assign(response, { x: target.x - 1200, y: target.y, elevation: 200, angle: 0, grounded: false });
  aviation._phase(response, 'military-intercept');
  for (let shot = 0; shot < 30 && target.health > 0; shot++) {
    response.gunCooldown = 0; aviation.time = 0;
    assert.equal(aviation._fireForward(response, target), true);
    aviation._projectiles(.4);
  }
  assert.equal(target.health, 0); assert.equal(target.burning, true); assert.equal(target.flightPhase, 'wrecked');
  advance(aviation, 10.2);
  assert.equal(target.exploded, true); assert.equal(game.player.vehicleId, null); assert.equal(game.player.parachuting, true);
  assert.ok(game.player.elevation > aviation._ground(game.player) + 30);
  const command = aviation._militaryDuty(response, 1 / 60);
  assert.notEqual(command.fire, true); assert.equal(response.flightPhase, 'military-search');
});

test('both response types complete repeated actual-world launch, pursuit and base returns without collision or teleportation', () => {
  for (const mode of ['air', 'ground']) {
    const game = new Game({ seed: 42 }), aviation = game.aviation;
    aviation._policeCooldown = aviation._newsCooldown = 10000;
    const target = mode === 'air' ? targetAircraft(aviation, game) : game.cars[0];
    if (mode === 'ground') { Object.assign(target, { x: 6000, y: 4300, elevation: game._ground({ x: 6000, y: 4300 }) }); game.player.vehicleId = target.id; }
    // This test measures the complete flight circuit, not target destruction.
    const damageVehicle = game._damageVehicle; game._damageVehicle = () => {};
    const aircraftDamage = aviation.damage.bind(aviation); aviation.damage = (entity, amount) => entity === target ? false : aircraftDamage(entity, amount);
    let response = null, previous = null, returns = 0, maximumStep = 0;
    const phases = new Set();
    for (let tick = 0; tick < 360 * 60; tick++) {
      const time = tick / 60; game.heat = time < 60 || time >= 180 && time < 240 ? 4 : 3;
      const before = response && { x: response.x, y: response.y };
      aviation.step(1 / 60, {}); response ||= aviation.aircraft.find(entity => entity.militaryRole === (mode === 'air' ? 'interceptor' : 'gunship'));
      if (!response) continue;
      phases.add(response.flightPhase);
      if (response.flightPhase === 'parked' && previous !== 'parked') returns++;
      previous = response.flightPhase;
      if (before) maximumStep = Math.max(maximumStep, Math.hypot(response.x - before.x, response.y - before.y));
      assert.equal(response.health, response.maxHealth, mode + ' remains clear of actual terrain, buildings, fences and parked aircraft');
      assert.ok(aviation.aircraft.filter(entity => entity.militaryResponse).length <= 1);
    }
    game._damageVehicle = damageVehicle;
    assert.ok(returns >= 2, mode + ' completes two physical base returns');
    assert.ok(maximumStep < 30, mode + ' never teleports');
    assert.equal(response.flightPhase, 'parked'); assert.ok(response.y < -1000); assert.equal(response.elevation, 14);
    for (const phase of mode === 'air' ? ['boarding', 'taxi', 'takeoff', 'military-intercept', 'military-return', 'arrival', 'landing', 'taxi-in'] : ['military-lift', 'military-intercept', 'military-return']) assert.ok(phases.has(phase), mode + ' visits ' + phase);
  }
});
