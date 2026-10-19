'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AircraftSystem, WEAPONS, LOCK_TIME, LOCK_RANGE, SCALE } = require('../aircraft.js');
const { Game } = require('../core.js');

function fixture(options = {}) {
  const hits = [], game = {
    world: { mapWidth: 12000, mapHeight: 8000, landscape: {} },
    player: { id: 'player', x: 1000, y: 1000, elevation: 50, angle: 0, vehicleId: null, composure: 100 },
    cars: [], police: [], peds: [], buildings: [], staticObjects: [], heat: 0,
    _ground: () => 0, _blockedLine: () => false,
    _damageVehicle: (entity, amount) => { hits.push({ entity, amount }); entity.health -= amount; },
    ...options
  };
  const aviation = new AircraftSystem(game, { spawn: false });
  game.aviation = aviation; game.aircraft = aviation.aircraft;
  Object.defineProperty(game, 'current', { get: () => aviation.current || game.player });
  function pilot(type = 'fighter') {
    const entity = aviation.spawn(type, { x: 1000, y: 1000, elevation: 50, angle: 0 });
    game.player.vehicleId = entity.id;
    return entity;
  }
  function airTarget(options = {}) {
    return aviation.spawn('fighter', { x: 3000, y: 1000, elevation: 50, angle: 0 }, { grounded: false, ...options });
  }
  return { game, aviation, pilot, airTarget, hits };
}

const aim = (aviation, entity, target) => {
  const from = aviation._weaponMuzzle(entity), height = target.kind === 'tank' ? 1.2 : 2;
  return { aimAngle: Math.atan2(target.y - from.y, target.x - from.x),
    aimPitch: Math.atan2((target.elevation + height - from.elevation) * SCALE, Math.hypot(target.x - from.x, target.y - from.y)) };
};

test('armed aircraft carry a small guided load or a larger rocket load, while civilian aircraft stay unarmed', () => {
  const { aviation, pilot } = fixture();
  const jet = pilot();
  assert.equal(jet.secondaryAmmo, 6);
  for (const type of ['policeheli', 'transportheli']) {
    const heli = pilot(type);
    assert.equal(heli.secondaryAmmo, 24);
    assert.ok(heli.secondaryAmmo > jet.secondaryAmmo);
  }
  const civilian = pilot('helicopter');
  aviation._playerWeapons(civilian, { fire: true, altFire: true, aimAngle: 0 }, 1);
  assert.equal(aviation.aircraftProjectiles.length, 0);
});

test('left fire repeats the machine gun without spending secondary ammo and respects each aircraft aim', () => {
  for (const type of ['fighter', 'policeheli', 'transportheli']) {
    const { aviation, pilot } = fixture(), entity = pilot(type), ammo = entity.secondaryAmmo;
    const input = { fire: true, aimAngle: .35, aimPitch: -.2 };
    for (let tick = 0; tick < 22; tick++) aviation.step(1 / 60, input);
    assert.ok(aviation.aircraftProjectiles.length >= 3, type + ' has sustained automatic fire');
    assert.ok(aviation.aircraftProjectiles.every(round => round.weapon === 'machine-gun'));
    assert.equal(entity.secondaryAmmo, ammo);
    assert.equal(entity.weaponLock, null);
    const round = aviation.aircraftProjectiles[0];
    if (type === 'fighter') {
      assert.ok(Math.abs(round.vy) < 1e-8, 'jet cannon follows the nose instead of camera yaw');
    } else {
      assert.ok(round.vy > 0 && round.vz < 0, 'helicopter cannon follows the forward camera aim');
      const count = aviation.aircraftProjectiles.length;
      entity.gunCooldown = 0;
      aviation._playerWeapons(entity, { fire: true, aimAngle: Math.PI }, 1 / 60);
      assert.equal(aviation.aircraftProjectiles.length, count, 'the gun cannot fire backward through the cabin');
    }
  }
});

test('jet secondary fire requires a continuous lock before launching and release cancels acquisition', () => {
  const { aviation, pilot, airTarget } = fixture(), jet = pilot(), target = airTarget();
  const input = { altFire: true, ...aim(aviation, jet, target) };
  aviation._playerWeapons(jet, input, LOCK_TIME * .6);
  assert.equal(aviation.aircraftProjectiles.length, 0);
  assert.equal(jet.weaponLock.targetId, target.id);
  aviation._playerWeapons(jet, { ...input, altFire: false }, .1);
  assert.equal(jet.weaponLock, null);
  aviation._playerWeapons(jet, input, LOCK_TIME * .6);
  assert.equal(aviation.aircraftProjectiles.length, 0, 'the released partial lock is not reused');
  aviation._playerWeapons(jet, input, LOCK_TIME * .41);
  assert.equal(aviation.aircraftProjectiles.length, 1);
  const missile = aviation.aircraftProjectiles[0];
  assert.equal(missile.weapon, 'missile'); assert.equal(missile.targetId, target.id);
  assert.equal(jet.secondaryAmmo, 5); assert.ok(jet.secondaryCooldown > 0);
});

test('switching jet targets starts a fresh lock and launch cooldown prevents another missile', () => {
  const { aviation, pilot, airTarget } = fixture(), jet = pilot(), first = airTarget();
  aviation._playerWeapons(jet, { altFire: true, ...aim(aviation, jet, first) }, .7);
  first.visible = false;
  const second = airTarget({ x: 2800, y: 1200 });
  const input = { altFire: true, ...aim(aviation, jet, second) };
  aviation._playerWeapons(jet, input, .4);
  assert.equal(aviation.aircraftProjectiles.length, 0);
  assert.equal(jet.weaponLock.targetId, second.id); assert.ok(jet.weaponLock.progress < .5);
  aviation._playerWeapons(jet, input, .61);
  assert.equal(aviation.aircraftProjectiles.length, 1);
  aviation._playerWeapons(jet, input, LOCK_TIME + .01);
  assert.equal(aviation.aircraftProjectiles.length, 1, 'acquiring again does not bypass launch cooldown');
  assert.equal(jet.secondaryAmmo, 5);
});

test('jet locks only onto live tanks or airborne aircraft in view and within range', () => {
  const { game, aviation, pilot, airTarget } = fixture(), jet = pilot(), target = airTarget();
  const input = aim(aviation, jet, target);
  assert.equal(aviation._lockCandidate(jet, input), target);
  for (const invalid of [{ grounded: true }, { health: 0 }, { exploded: true }, { visible: false }, { active: false }]) {
    const previous = { ...target };
    Object.assign(target, invalid);
    assert.equal(aviation._lockCandidate(jet, input), null);
    Object.assign(target, previous);
  }
  target.visible = false;
  const tank = { id: 'tank', kind: 'tank', x: 2500, y: 1000, elevation: 0, health: 600, angle: 0 };
  game.cars.push(tank);
  assert.equal(aviation._lockCandidate(jet, aim(aviation, jet, tank)), tank, 'a tank below the jet is eligible');
  tank.kind = 'compact';
  assert.equal(aviation._lockCandidate(jet, aim(aviation, jet, tank)), null, 'ordinary traffic is not a lock target');
  tank.kind = 'tank'; tank.x = jet.x + LOCK_RANGE + 300;
  assert.equal(aviation._lockCandidate(jet, aim(aviation, jet, tank)), null, 'range includes vertical distance');
  tank.x = jet.x - 2000;
  assert.equal(aviation._lockCandidate(jet, aim(aviation, jet, tank)), null, 'looking behind the jet cannot acquire');
});

test('terrain and buildings break jet acquisition and an interrupted lock loses its progress', () => {
  const { game, aviation, pilot, airTarget } = fixture(), jet = pilot(), target = airTarget();
  const input = { altFire: true, ...aim(aviation, jet, target) };
  aviation._playerWeapons(jet, input, .7);
  game.buildings.push({ x: 2000, y: 800, w: 30, h: 400, height: 80, elevation: 0 });
  aviation._playerWeapons(jet, input, .4);
  assert.equal(jet.weaponLock, null); assert.equal(aviation.aircraftProjectiles.length, 0);
  game.buildings.length = 0;
  game._ground = point => point.x > 1900 && point.x < 2100 ? 80 : 0;
  assert.equal(aviation._lockCandidate(jet, input), null);
  game._ground = () => 0;
  aviation._playerWeapons(jet, input, .4);
  assert.equal(aviation.aircraftProjectiles.length, 0, 'cover resets acquisition rather than pausing it');
});

test('helicopter rockets fire immediately, remain straight and can fire alongside the machine gun', () => {
  for (const type of ['policeheli', 'transportheli']) {
    const { aviation, pilot } = fixture(), heli = pilot(type);
    aviation._playerWeapons(heli, { fire: true, altFire: true, aimAngle: .3, aimPitch: -.15 }, 1 / 60);
    assert.deepEqual(aviation.aircraftProjectiles.map(round => round.weapon), ['machine-gun', 'rocket']);
    assert.equal(heli.secondaryAmmo, 23); assert.equal(heli.weaponLock, null);
    const rocket = aviation.aircraftProjectiles.find(round => round.weapon === 'rocket');
    const velocity = [rocket.vx, rocket.vy, rocket.vz], before = { ...rocket };
    aviation._projectiles(.1);
    assert.deepEqual([rocket.vx, rocket.vy, rocket.vz], velocity);
    assert.ok(Math.abs(rocket.x - before.x - before.vx * .1) < 1e-8);
    assert.ok(Math.abs(rocket.elevation - before.elevation - before.vz * .1) < 1e-8);
    assert.equal(rocket.targetId, undefined);
    aviation._playerWeapons(heli, { altFire: true, aimAngle: .3 }, .01);
    assert.equal(heli.secondaryAmmo, 23, 'holding right fire respects the rocket launch interval');
  }
});

test('guided missiles turn gradually in 3D and stop homing when their target disappears or gains cover', () => {
  const { game, aviation, pilot, airTarget } = fixture(), jet = pilot(), target = airTarget();
  aviation._playerWeapons(jet, { altFire: true, ...aim(aviation, jet, target) }, LOCK_TIME + .01);
  const missile = aviation.aircraftProjectiles[0], speed = WEAPONS.fighter.speed;
  target.y += 800; target.elevation += 30;
  aviation._guideMissile(missile, .05);
  const turn = Math.acos(Math.max(-1, Math.min(1, missile.vx / speed)));
  assert.ok(turn > 0 && turn <= 1.8 * .05 + 1e-7, 'missiles cannot snap to a new heading');
  assert.ok(missile.vy > 0 && missile.vz > 0);
  assert.ok(Math.abs(Math.hypot(missile.vx, missile.vy, missile.vz * SCALE) - speed) < 1e-6);
  game.buildings.push({ x: 2100, y: 800, w: 30, h: 1600, height: 150, elevation: 0 });
  const velocity = [missile.vx, missile.vy, missile.vz];
  aviation._guideMissile(missile, .05);
  assert.equal(missile.targetId, null); assert.deepEqual([missile.vx, missile.vy, missile.vz], velocity);
  game.buildings.length = 0; missile.targetId = target.id; target.exploded = true;
  aviation._guideMissile(missile, .05);
  assert.equal(missile.targetId, null);
});

test('a guided missile damages its air target and a thin wall intercepts an unguided rocket', () => {
  const { game, aviation, pilot, airTarget } = fixture(), jet = pilot(), target = airTarget();
  const health = target.health;
  aviation._playerWeapons(jet, { altFire: true, ...aim(aviation, jet, target) }, LOCK_TIME + .01);
  for (let tick = 0; tick < 90; tick++) aviation._projectiles(1 / 60);
  assert.equal(target.health, health - WEAPONS.fighter.damage);
  assert.equal(aviation.aircraftProjectiles.length, 0);
  const heli = pilot('policeheli');
  game.buildings.push({ x: 1400, y: 700, w: 4, h: 600, elevation: 0, height: 100 });
  aviation._playerWeapons(heli, { altFire: true, aimAngle: 0, aimPitch: 0 }, 1 / 60);
  assert.equal(aviation.aircraftProjectiles.length, 1);
  aviation._projectiles(.25);
  assert.equal(aviation.aircraftProjectiles.length, 0, 'swept impacts catch thin walls at rocket speed');
});

test('a jet missile tracks down to the actual tank solids and applies vehicle damage', () => {
  const { game, aviation, pilot, hits } = fixture(), jet = pilot();
  const tank = { id: 'tank', kind: 'tank', x: 3000, y: 1000, angle: 0, elevation: 0, health: 600 };
  game.cars.push(tank);
  aviation._playerWeapons(jet, { altFire: true, ...aim(aviation, jet, tank) }, LOCK_TIME + .01);
  assert.equal(aviation.aircraftProjectiles[0].targetId, tank.id);
  for (let tick = 0; tick < 150; tick++) aviation._projectiles(1 / 60);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].entity, tank); assert.equal(hits[0].amount, WEAPONS.fighter.damage);
  assert.equal(tank.health, 600 - WEAPONS.fighter.damage);
  assert.equal(aviation.aircraftProjectiles.length, 0);
});

test('empty secondary pods cannot fire and servicing restores the correct aircraft load', () => {
  for (const type of ['fighter', 'policeheli', 'transportheli']) {
    const { aviation, pilot, airTarget } = fixture(), entity = pilot(type), target = airTarget();
    const input = { altFire: true, ...aim(aviation, entity, target) };
    entity.secondaryAmmo = 0;
    aviation._playerWeapons(entity, input, LOCK_TIME + .1);
    assert.equal(aviation.aircraftProjectiles.length, 0); assert.equal(entity.weaponLock, null);
    entity.secondaryCooldown = 2;
    assert.equal(aviation.rearm(entity), true);
    assert.equal(entity.secondaryAmmo, WEAPONS[type].capacity); assert.equal(entity.secondaryCooldown, 0);
    aviation._playerWeapons(entity, input, LOCK_TIME + .1);
    assert.equal(entity.secondaryAmmo, WEAPONS[type].capacity - 1);
  }
});

test('grounded aircraft automatically rearm after three idle seconds at an airfield', () => {
  for (const type of ['fighter', 'policeheli', 'transportheli']) {
    const notices = [], { aviation, pilot } = fixture({ _toast: text => notices.push(text) });
    const entity = pilot(type), pad = aviation.airports.civilian.helipads[0];
    Object.assign(entity, { x: pad.x, y: pad.y, elevation: 0, grounded: true, speed: 0, secondaryAmmo: 0 });
    aviation._playerWeapons(entity, {}, 2.99);
    assert.equal(entity.secondaryAmmo, 0, 'the service interval must finish');
    aviation._playerWeapons(entity, {}, .02);
    assert.equal(entity.secondaryAmmo, WEAPONS[type].capacity);
    assert.equal(entity.secondaryCooldown, 0);
    assert.equal(notices.filter(text => text === 'Aircraft weapons rearmed.').length, 1);
    aviation._playerWeapons(entity, {}, 4);
    assert.equal(notices.filter(text => text === 'Aircraft weapons rearmed.').length, 1, 'full pods do not repeatedly trigger service');
  }
});

test('firing, moving, taking off or leaving an airfield cancels the automatic rearm interval', () => {
  const interruptions = [
    { name: 'primary fire', input: { fire: true, aimAngle: 0 } },
    { name: 'secondary fire', input: { altFire: true, aimAngle: 0 } },
    { name: 'motion', change: entity => { entity.speed = 30; } },
    { name: 'airborne', change: entity => { entity.grounded = false; } },
    { name: 'away from the field', change: entity => { entity.x = 1000; entity.y = 1000; } }
  ];
  for (const interruption of interruptions) {
    const { aviation, pilot } = fixture(), entity = pilot('policeheli'), pad = aviation.airports.civilian.helipads[0];
    const ready = () => Object.assign(entity, { x: pad.x, y: pad.y, elevation: 0, grounded: true, speed: 0 });
    ready(); entity.secondaryAmmo = 0;
    aviation._playerWeapons(entity, {}, 2.5);
    interruption.change?.(entity);
    aviation._playerWeapons(entity, interruption.input || {}, .6);
    assert.equal(entity.secondaryAmmo, 0, interruption.name + ' prevents service');
    ready();
    aviation._playerWeapons(entity, {}, .6);
    assert.equal(entity.secondaryAmmo, 0, interruption.name + ' resets the partial interval');
    aviation._playerWeapons(entity, {}, 2.41);
    assert.equal(entity.secondaryAmmo, 24, 'a new uninterrupted interval can complete');
  }
});

test('spent aircraft ammunition survives storing, export, reload and hangar retrieval', () => {
  const game = new Game({ seed: 42 });
  const fighter = game.aircraft.find(entity => entity.aircraftType === 'fighter' && !entity.npc);
  Object.assign(game.player, { x: fighter.x + 130, y: fighter.y, elevation: fighter.elevation, vehicleId: null, grounded: true });
  assert.equal(game.interact(), true); assert.equal(game.current, fighter);
  fighter.secondaryAmmo = 2;
  assert.equal(game.hangarStore(), true);
  const id = fighter.hangarId;
  assert.equal(game.hangar.aircraft.find(record => record.id === id).secondaryAmmo, 2);
  fighter.secondaryAmmo = 1;
  const saved = game.exportSave();
  assert.equal(saved.hangar.aircraft.find(record => record.id === id).secondaryAmmo, 1, 'export syncs the deployed aircraft load');
  assert.equal(game.hangarRetrieve(id), true);
  assert.equal(game.current.secondaryAmmo, 1, 'retrieving an existing aircraft does not refill it');
  const copy = new Game({ seed: 42 });
  assert.equal(copy.loadSave(saved), true);
  assert.equal(copy.hangar.aircraft.find(record => record.id === id).secondaryAmmo, 1);
  Object.assign(copy.player, { x: 3700, y: -2090, elevation: 14, grounded: true, vehicleId: null });
  assert.equal(copy.hangarRetrieve(id), true);
  assert.equal(copy.current.aircraftType, 'fighter'); assert.equal(copy.current.secondaryAmmo, 1);
});

test('save loading clamps aircraft ammunition and gives older aircraft saves their initial load', () => {
  const game = new Game({ seed: 42 });
  const cases = [
    { type: 'fighter', ammo: 999, expected: 6 },
    { type: 'policeheli', ammo: -5, expected: 0 },
    { type: 'transportheli', ammo: 11.9, expected: 11 },
    { type: 'fighter', expected: 6 },
    { type: 'policeheli', expected: 24 },
    { type: 'transportheli', ammo: NaN, expected: 24 },
    { type: 'helicopter', ammo: 50, expected: 0 }
  ];
  for (const example of cases) {
    const record = { id: 'air-1', aircraftType: example.type, health: 100, maxHealth: 100 };
    if (Object.hasOwn(example, 'ammo')) record.secondaryAmmo = example.ammo;
    assert.equal(game.loadSave({ version: 2, hangar: { aircraft: [record] } }), true);
    assert.equal(game.hangar.aircraft[0].secondaryAmmo, example.expected, example.type + ' ammo ' + example.ammo);
    assert.equal(game.exportSave().hangar.aircraft[0].secondaryAmmo, example.expected);
  }
});
