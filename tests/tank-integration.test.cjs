'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GARAGE_SERVICE_TIMING } = require('../core.js');

function fixture({ personnel = false } = {}) {
  const game = new Game({ seed: 42 });
  game.police = [];
  if (!personnel) game.peds = [];
  game.aviation._policeCooldown = game.aviation._newsCooldown = 10000;
  game.graceTimer = 0;
  game.drainEvents();
  return game;
}
function place(game, x, y, angle = 0) {
  Object.assign(game.player, { x, y, angle, elevation: game._ground(x, y), grounded: true, vehicleId: null });
  game.vehiclePhysics.sync();
}
function equip(game, gadget) {
  game.inventory.equipped = gadget;
  if (!game.inventory.unlocked.includes(gadget)) game.inventory.unlocked.push(gadget);
  game.inventory.ammo.cannon = 12;
}
function alarm(game, reason) {
  assert.equal(game.heat, 4, reason);
  if (!game.peds.length) assert.equal(game._witnessReports.length, 0, 'base security reports immediately without a civilian witness');
  assert.ok(game.drainEvents().some(event => event.text && /base|Northwatch|tank/i.test(event.text)), 'the base alarm is visible to the player');
}
function aircraftRound(game, from, to, npc = false) {
  game.aviation.aircraftProjectiles.push({ id: 'integration-round', ...from, height: from.elevation,
    vx: to.x - from.x, vy: to.y - from.y, vz: to.elevation - from.elevation,
    life: 2, ownerId: 'integration-shooter', npc, damage: 8 });
  game.aviation._projectiles(1);
}

test('actual close weapons alarm Northwatch on a physical building, fence, utility or personnel hit', () => {
  for (const gadget of ['popper', 'hammer']) for (const target of ['building', 'fence', 'utility', 'personnel']) {
    const game = fixture({ personnel: target === 'personnel' });
    equip(game, gadget);
    if (target === 'building') place(game, 6130, -930);
    else if (target === 'fence') place(game, 6570, -2700);
    else if (target === 'utility') place(game, 3350, -1320);
    else place(game, 1900, -1160);
    assert.equal(game.action(0, { pitch: 0 }), true);
    alarm(game, gadget + ' hit on the actual base ' + target);
  }
});

test('missed, skyward, outside-base and physically screened close strikes do not trigger the military', () => {
  for (const gadget of ['popper', 'hammer']) for (const scenario of ['miss', 'sky', 'outside', 'cover']) {
    const game = fixture(); equip(game, gadget);
    if (scenario === 'miss') place(game, 6025, -800, Math.PI);
    else if (scenario === 'outside') place(game, 1000, 1000);
    else {
      place(game, 6130, -930);
      if (scenario === 'cover') {
        game.staticObjects = game.staticObjects.concat({ id: 'civil-cover', kind: 'fence', x: 6155, y: -930,
          elevation: 14, angle: 0, destructible: true, health: 100,
          parts: [{ offset: [0, 1.2, 0], half: [.12, 1.2, 2] }] });
        game.vehiclePhysics.sync();
      }
    }
    const angle = scenario === 'miss' ? Math.PI : 0;
    assert.equal(game.action(angle, { pitch: scenario === 'sky' ? 1.3 : 0 }), true);
    assert.equal(game.heat, 0, gadget + ' ' + scenario + ' does not count as attacking base property');
  }
});

test('the real Party Cannon alarms only after its first physical base impact', () => {
  const game = fixture(); equip(game, 'cannon'); place(game, 6095, -930);
  assert.equal(game.action(0, { pitch: 0 }), true);
  assert.equal(game.heat, 0, 'launching inside the perimeter alone is not a base attack');
  game._projectiles(.1); assert.equal(game.heat, 0, 'the projectile is still short of the wall');
  game._projectiles(.2); assert.equal(game.projectiles.length, 0);
  alarm(game, 'a Party Cannon projectile physically struck the gatehouse');
  for (const scenario of ['miss', 'cover']) {
    const quiet = fixture(); equip(quiet, 'cannon'); place(quiet, 6095, -930);
    if (scenario === 'cover') {
      quiet.staticObjects = quiet.staticObjects.concat({ id: 'civil-cover', kind: 'fence', x: 6140, y: -930,
        elevation: 14, destructible: false, parts: [{ offset: [0, 1.2, 0], half: [.12, 1.2, 2] }] });
      quiet.vehiclePhysics.sync();
    }
    quiet.action(scenario === 'miss' ? Math.PI : 0, { pitch: 0 }); quiet._projectiles(.7);
    assert.equal(quiet.heat, 0, scenario + ' does not report a target beyond the first impact');
  }
});

test('player aircraft cannon attributes the nearest building, fence or vehicle impact and ignores NPC collateral', () => {
  for (const target of ['building', 'fence', 'utility']) {
    const game = fixture();
    const [from, to] = target === 'building'
      ? [{ x: 6090, y: -930, elevation: 15.2 }, { x: 6380, y: -930, elevation: 15.2 }]
      : target === 'fence'
        ? [{ x: 6530, y: -2700, elevation: 15.2 }, { x: 6710, y: -2700, elevation: 15.2 }]
        : [{ x: 3300, y: -1320, elevation: 14.8 }, { x: 3500, y: -1320, elevation: 14.8 }];
    aircraftRound(game, from, to); alarm(game, 'a player aircraft round hit the actual base ' + target);
    const npc = fixture(); aircraftRound(npc, from, to, true);
    assert.equal(npc.heat, 0, 'NPC cannon collateral does not accuse the player');
  }
  const covered = fixture();
  covered.staticObjects = covered.staticObjects.concat({ id: 'civil-cover', kind: 'fence', x: 6140, y: -930,
    elevation: 14, destructible: false, parts: [{ offset: [0, 1.2, 0], half: [.12, 1.2, 2] }] });
  aircraftRound(covered, { x: 6090, y: -930, elevation: 15.2 }, { x: 6380, y: -930, elevation: 15.2 });
  assert.equal(covered.heat, 0, 'a civilian obstruction shields the base behind it');
  const miss = fixture();
  aircraftRound(miss, { x: 6000, y: -2500, elevation: 60 }, { x: 6000, y: -2700, elevation: 60 });
  assert.equal(miss.heat, 0, 'a cannon miss over the base is not an attack on a physical target');
});

test('actual player airframe crashes alarm the base for building and utility contacts while NPC crashes stay quiet', () => {
  for (const target of ['building', 'utility']) for (const playerPiloted of [true, false]) {
    const game = fixture(), before = target === 'building'
      ? { x: 6000, y: -930, elevation: 14.3, angle: 0 }
      : { x: 3900, y: -1320, elevation: 14.3, angle: Math.PI };
    const utility = game.cars.find(car => car.baseId === 'military' && car.x === 3650), previousUtilityHealth = utility.health;
    const craft = game.aviation.spawn('trainer', before, { npc: !playerPiloted, borrowed: playerPiloted });
    if (playerPiloted) game.player.vehicleId = craft.id;
    Object.assign(craft, { x: target === 'building' ? 6240 : 3600, speed: 260, vz: 0, grounded: false });
    game.aviation._collide(craft, before);
    assert.ok(craft.health < craft.maxHealth, 'the real swept airframe collision damages the aircraft');
    assert.ok(craft.speed < 0, 'the aircraft bounces from the physical contact');
    if (target === 'utility') assert.ok(utility.health < previousUtilityHealth, 'the real base utility receives collision damage');
    if (playerPiloted) alarm(game, 'a player airframe physically crashed into the base ' + target);
    else assert.equal(game.heat, 0, 'an NPC aircraft crash is not attributed to the player');
  }
});

test('actual player ramming contacts report base property while NPC collisions and gentle taps stay quiet', () => {
  for (const target of ['building', 'fence', 'utility']) for (const playerDriven of [true, false]) {
    const game = fixture();
    const point = target === 'building' ? { x: 6060, y: -930 } : target === 'fence' ? { x: 6500, y: -2700 } : { x: 3290, y: -1320 };
    const car = game._addCar(point.x, point.y, 0, 'van', '#ffd15b');
    Object.assign(car, { speed: 210, vx: 210, vy: 0, traffic: false });
    if (playerDriven) game.player.vehicleId = car.id;
    const impacts = [], physicsStep = game.vehiclePhysics.step.bind(game.vehiclePhysics);
    game.vehiclePhysics.step = dt => { const contacts = physicsStep(dt); impacts.push(...contacts); return contacts; };
    game.vehiclePhysics.sync();
    for (let tick = 0; tick < 42; tick++) game.update(1 / 60, playerDriven ? { up: true } : {});
    assert.ok(impacts.some(contact => contact.entity === car && (contact.prop?.district === 'military' || contact.prop?.militaryModel || contact.other?.baseId === 'military')), 'the van actually made a base property contact');
    if (playerDriven) alarm(game, 'a driven van physically rammed the base ' + target);
    else assert.equal(game.heat, 0, 'an NPC ram into the ' + target + ' is not attributed to the player');
  }
  const tap = fixture(), car = tap._addCar(6145, -930, 0, 'van', '#ffd15b');
  tap.player.vehicleId = car.id;
  Object.assign(car, { speed: 35, vx: 35, vy: 0 }); tap.vehiclePhysics.sync();
  advance(tap, .5);
  assert.equal(tap.heat, 0, 'a slow parking tap does not mobilise military armour');
});

function dispatch(game) {
  const tank = game.tankTraffic._dispatch();
  assert.ok(tank, 'a tank has a real clear dispatch position on the Northwatch road');
  game.vehiclePhysics.sync();
  return tank;
}
function advance(game, seconds, input = {}) {
  for (let tick = 0; tick < Math.ceil(seconds * 60); tick++) game.update(1 / 60, input);
}
function board(game, tank) {
  place(game, tank.x, tank.y + 55);
  assert.equal(game.interact(), true); assert.equal(game.current, tank);
}

test('the actual Game dispatch clock is continuous, pauses with the game, and offers an eight second warning', () => {
  const game = fixture(), target = game.cars[0];
  game.player.vehicleId = target.id; game.heat = 4;
  for (let tick = 0; tick < 59 * 60; tick++) game.tankTraffic.step(1 / 60);
  assert.equal(game.tankTraffic.warning, 0); assert.equal(game.tankTraffic.tanks.length, 0);
  const clock = game.tankTraffic.time;
  game.update(0); game.update(NaN); assert.equal(game.tankTraffic.time, clock, 'paused updates cannot advance the tank clock');
  game.heat = 3; game.tankTraffic.step(1 / 60); assert.equal(game.tankTraffic.fourStarTime, 0);
  game.heat = 4;
  for (let tick = 0; tick < 60.1 * 60; tick++) game.tankTraffic.step(1 / 60);
  assert.ok(game.tankTraffic.warning > 7.8 && game.tankTraffic.warning <= 8); assert.equal(game.tankTraffic.tanks.length, 0);
  for (let tick = 0; tick < 8.1 * 60; tick++) game.tankTraffic.step(1 / 60);
  assert.equal(game.tankTraffic.tanks.length, 1); assert.ok(game.cars.includes(game.tankTraffic.tanks[0]));
});

test('a base hit mobilises on foot without waiting a minute, while garage service cancels an unfinished mobilisation', () => {
  const game = fixture(); game.heat = 4; game.escapeTimer = 31.5;
  place(game, 6130, -930); game.action(0, { pitch: 0 });
  assert.equal(game.player.vehicleId, null); assert.equal(game.heat, 4);
  assert.equal(game.escapeTimer, 0, 'a fresh physical base hit resets an almost-complete four-star escape');
  advance(game, 2);
  assert.equal(game.heat, 4, 'the new alarm cannot immediately expire through the previous escape timer');
  assert.ok(game.tankTraffic.warning > 5.8 && game.tankTraffic.warning <= 6.1, 'mobilisation continues through actual Game heat and police updates');
  assert.equal(game.tankTraffic.tanks.length, 0, 'the eight-second warning has not elapsed after two seconds');
  for (let tick = 0; tick < 6.2 * 60; tick++) game.tankTraffic.step(1 / 60);
  assert.equal(game.tankTraffic.tanks.length, 1, 'a real base hit bypasses the four-star buildup and ground-vehicle requirement');
  const quiet = fixture(); place(quiet, 6130, -930); quiet.action(0, { pitch: 0 });
  for (let tick = 0; tick < 3 * 60; tick++) quiet.tankTraffic.step(1 / 60);
  assert.ok(quiet.tankTraffic.warning > 0);
  const car = quiet.cars[0], workshop = quiet.services.find(service => service.id === 'repair');
  Object.assign(car, { x: workshop.x, y: workshop.y, elevation: quiet._ground(workshop), speed: 0, vx: 0, vy: 0 });
  quiet.player.vehicleId = car.id; quiet.money = 1000;
  assert.equal(quiet._useService(workshop), true); advance(quiet, GARAGE_SERVICE_TIMING.blackAt + .01); assert.equal(quiet.heat, 0);
  assert.equal(quiet.tankTraffic.warning, 0); assert.equal(quiet.tankTraffic.baseAlarmTime, 0); assert.equal(quiet.tankTraffic.fourStarTime, 0);
  for (let tick = 0; tick < 10 * 60; tick++) quiet.tankTraffic.step(1 / 60);
  assert.equal(quiet.tankTraffic.tanks.length, 0);
});

test('a player can board, drive, independently aim and fire the actual tank, then safely exit and recover it', () => {
  const game = fixture(), tank = dispatch(game);
  board(game, tank); const before = { x: tank.x, y: tank.y };
  advance(game, 2.8, { up: true, aimAngle: Math.PI / 2, aimPitch: .12 });
  assert.equal(tank.tankAI, false); assert.equal(tank.traffic, false);
  assert.ok(Math.hypot(tank.x - before.x, tank.y - before.y) > 40, 'normal driving input moves the physical tracked chassis');
  assert.ok(Math.abs(tank.angle) < .1, 'aiming does not steer the chassis');
  assert.ok(Math.abs(tank.tankGun.turretAngle - Math.PI / 2) < .02); assert.ok(Math.abs(tank.tankGun.pitch - .12) < .01);
  assert.equal(tank.health, 600); assert.equal(tank.maxHealth, 600);
  game.update(1 / 60, { fire: true, aimAngle: Math.PI / 2, aimPitch: .12 });
  assert.equal(game.tankShells.length, 1, 'player fire creates a live ballistic shell through the Game update');
  assert.equal(game.tankShells[0].npc, false); assert.equal(game.tankShells[0].ownerId, tank.id);
  tank.speed = tank.vx = tank.vy = 0; game.vehiclePhysics.reset(tank);
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null);
  assert.equal(game._personFree(game.player.x, game.player.y), true, 'the exit position clears the real chassis and gun');
  board(game, tank);
  Object.assign(tank, { x: 6000, y: 3950, health: 410, engineHealth: 72, handlingHealth: 83, elevation: 45, upright: false });
  assert.equal(game.tankTraffic.roadIds.has(game.network.nearestRoad(tank).roadId), false, 'the borrowed tank starts recovery on an unsuitable downtown street');
  const cash = game.money;
  assert.equal(game.recover(), true); assert.equal(game.current, tank); assert.equal(tank.upright, true);
  assert.equal(tank.health, 410); assert.equal(tank.maxHealth, 600); assert.equal(tank.engineHealth, 72); assert.equal(tank.handlingHealth, 83);
  assert.equal(game.money, cash); assert.equal(game._vehicleFree(tank), true);
  assert.ok(game.tankTraffic.roadIds.has(game.network.nearestRoad(tank).roadId), 'tank recovery chooses an approved open road');
});

test('tank repairs retain the 600-point hull, upgrades do not shrink it, and civilian garages cannot store it', () => {
  const game = fixture(), tank = dispatch(game); board(game, tank);
  Object.assign(tank, { health: 400, engineHealth: 70, handlingHealth: 60 });
  assert.equal(game.usePocket('repairTape'), true);
  assert.equal(tank.maxHealth, 600); assert.equal(tank.health, 455); assert.equal(tank.engineHealth, 100); assert.equal(tank.handlingHealth, 100);
  const garage = game.services.find(service => service.id === 'garage');
  Object.assign(tank, { x: garage.x, y: garage.y, elevation: game._ground(garage), speed: 0, vx: 0, vy: 0 });
  Object.assign(game.player, { x: tank.x, y: tank.y, elevation: tank.elevation });
  game.vehiclePhysics.reset(tank); game.money = 1000;
  assert.equal(game.garageAvailable, true); assert.equal(game.garageStore(), false); assert.equal(game.garage.cars.length, 0);
  assert.equal(game.purchase('repair'), true); assert.equal(tank.health, 600); assert.equal(tank.maxHealth, 600);
  assert.equal(game.purchase('armor'), true); assert.equal(tank.health, 600); assert.equal(tank.maxHealth, 600);
  const workshop = game.services.find(service => service.id === 'repair');
  Object.assign(tank, { x: workshop.x, y: workshop.y, elevation: game._ground(workshop), health: 350, speed: 0, vx: 0, vy: 0 });
  game.heat = 4; game.tankTraffic.fourStarTime = 65;
  assert.equal(game._useService(workshop), true); advance(game, GARAGE_SERVICE_TIMING.blackAt + .01); assert.equal(game.heat, 0);
  assert.equal(tank.health, 600); assert.equal(tank.maxHealth, 600); assert.equal(game.tankTraffic.fourStarTime, 0);
  const hostileSave = game.exportSave(); hostileSave.garage.cars = [{ id: 'ride-1', kind: 'tank', modelId: 'northwatch-warden', color: '#ffd15b', health: 600 }];
  assert.equal(game.loadSave(hostileSave), true); assert.equal(game.garage.cars.length, 0, 'save loading cannot smuggle an army tank into civilian storage');
});

test('actual Cannon tank pursuit negotiates the base gate and ridge on approved open roads without collisions or teleporting', () => {
  const game = fixture(), target = game.cars[0];
  Object.assign(target, { x: 5550, y: 1150, elevation: game._ground(5550, 1150), speed: 0, vx: 0, vy: 0, traffic: false });
  game.player.vehicleId = target.id; game.heat = 4; game.vehiclePhysics.sync();
  const tank = dispatch(game), roads = new Set();
  let travelled = 0, previous = { x: tank.x, y: tank.y }, sawTarget = false;
  for (let tick = 0; tick < 100 * 60; tick++) {
    // Step the production tank controller and Cannon chassis directly; other
    // city controllers stay parked so this measures the complete road drive.
    game.tankTraffic.step(1 / 60); game.vehiclePhysics.step(1 / 60);
    const movement = Math.hypot(tank.x - previous.x, tank.y - previous.y);
    assert.ok(movement < 6, 'every movement is a bounded physical chassis step');
    travelled += movement; previous = { x: tank.x, y: tank.y };
    sawTarget ||= game.militaryTankSeen;
    if (tick % 60 === 0) {
      const road = game.tankTraffic.network.nearestRoad(tank); roads.add(road.roadId);
      assert.ok(game.tankTraffic.roadIds.has(road.roadId)); assert.ok(road.distance < 45, 'the tracked footprint remains on the open road');
      assert.equal(tank.health, 600, 'normal route driving clears the actual buildings, fences and parked traffic');
      assert.equal(tank.tankPhase === 'return', false, 'four-star armour reaches its incident before searching or standing down');
    }
    // Preserve the fixed target for the full drive even if the tank reaches a
    // firing position; weapon damage is covered by the dedicated shell tests.
    target.health = target.maxHealth; target.engineHealth = target.handlingHealth = 100;
    target.burning = target.exploded = false;
  }
  assert.ok(travelled > 3500, 'the tank drives from the real motor pool through the gate to the outskirts');
  assert.ok(roads.has('base-compound-road') && roads.has('base-entry-road') && roads.has('base-gate-road'));
  assert.ok(sawTarget, 'the dispatched tank reaches a real sight line to the player');
});
