'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, SIZE } = require('../core.js');
const { PLAYER_RADIUS, NPC_RADIUS } = require('../physics.js');
const makeGame = () => new Game({ seed: 42 });
const advance = (game, seconds, input = {}) => { for (let t = 0; t < seconds - 0.0001; t += 1 / 60) game.update(1 / 60, input); };

test('town starts near a usable car and all contract targets are reachable', () => {
  const game = makeGame();
  assert.ok(game.buildings.length >= 90); assert.equal(game.world.size,SIZE);
  assert.equal(game.interact(), true);
  assert.equal(game.current.color, '#ffd15b');
  for (const type of ['delivery', 'dash', 'party']) {
    game.abandonMission(); assert.equal(game.acceptMission(type), true);
    for (const point of game.mission.targets) { assert.ok(game._isFree(point.x, point.y, 20)); assert.ok(game.network.nearestRoad(point).distance<1); }
  }
});

test('movement is frame-rate independent, normalized diagonally, and ignores invalid dt', () => {
  const a = makeGame(), b = makeGame();
  a.player.x = b.player.x = 1080; a.player.y = b.player.y = 900;
  for(const game of [a,b]) { game.buildings=[]; game.staticObjects=[]; game.peds=[]; game.cars=[]; game.police=[]; }
  a.update(0.25, { up: true, right: true }); advance(b, 0.25, { up: true, right: true });
  assert.ok(Math.hypot(a.player.x - b.player.x, a.player.y - b.player.y) < 0.00001);
  assert.ok(Math.abs(Math.hypot(a.player.x - 1080, a.player.y - 900) - 155 * 0.25) < 0.001);
  const before = { ...a.player }; a.update(NaN, { up: true }); a.update(-1, { up: true });
  assert.deepEqual(a.player, before);
});

test('on-foot movement follows the camera forward and right directions', () => {
  const cases = [
    { moveAngle: -Math.PI / 2, input: { up: true }, dx: 0, dy: -1 },
    { moveAngle: -Math.PI / 2, input: { right: true }, dx: 1, dy: 0 },
    { moveAngle: 0, input: { up: true }, dx: 1, dy: 0 },
    { moveAngle: 0, input: { right: true }, dx: 0, dy: 1 },
    { moveAngle: Math.PI / 2, input: { up: true }, dx: 0, dy: 1 },
    { moveAngle: Math.PI / 2, input: { right: true }, dx: -1, dy: 0 },
    { moveAngle: 0, input: { down: true }, dx: -1, dy: 0 },
    { moveAngle: 0, input: { left: true }, dx: 0, dy: -1 }
  ];
  for (const { moveAngle, input, dx, dy } of cases) {
    const game = makeGame(); game.player.x = 1080; game.player.y = 900;
    game.buildings=[]; game.staticObjects=[]; game.peds=[]; game.cars=[]; game.police=[];
    const start = { ...game.player };
    game.update(0.25, { ...input, moveAngle });
    assert.ok(Math.abs(game.player.x - start.x - dx * 155 * 0.25) < 0.00001);
    assert.ok(Math.abs(game.player.y - start.y - dy * 155 * 0.25) < 0.00001);
    assert.ok(Math.abs(Math.atan2(Math.sin(game.player.angle - Math.atan2(dy, dx)), Math.cos(game.player.angle - Math.atan2(dy, dx)))) < 0.00001);
  }
});

test('camera-relative diagonals keep walking and sprinting speed and face movement', () => {
  for (const moveAngle of [-Math.PI / 2, 0, Math.PI / 2, 0.7]) for (const boost of [false, true]) {
    const game = makeGame(); game.player.x = 1080; game.player.y = 900;
    // Verify movement vectors on a controlled open floor, independent of lots
    // and pedestrians along the new curved city streets.
    game.buildings=[]; game.staticObjects=[]; game.peds=[]; game.cars=[];
    const start = { ...game.player };
    game.update(0.25, { up: true, right: true, boost, moveAngle });
    const dx = game.player.x - start.x, dy = game.player.y - start.y;
    assert.ok(Math.abs(Math.hypot(dx, dy) - (boost ? 220 : 155) * 0.25) < 0.00001);
    assert.ok(Math.abs(Math.atan2(Math.sin(game.player.angle - moveAngle - Math.PI / 4), Math.cos(game.player.angle - moveAngle - Math.PI / 4))) < 0.00001);
  }
});

test('invalid camera headings preserve cardinal movement and opposing keys stop walking', () => {
  for (const moveAngle of [undefined, NaN, Infinity, -Infinity, '0', null]) {
    const game = makeGame();
    game.update(0.25, { up: true, moveAngle });
    assert.ok(Math.abs(game.player.x - 884) < 0.00001);
    assert.ok(Math.abs(game.player.y - 1080 + 155 * 0.25) < 0.00001);
  }
  const game = makeGame(), start = { ...game.player };
  game.update(0.25, { up: true, down: true, left: true, right: true, moveAngle: 0.7 });
  assert.deepEqual(game.player, start);
});

test('vehicle acceleration, braking, and steering ignore camera heading', () => {
  const inputs = [{ up: true }, { up: true, right: true, boost: true }, { down: true, left: true }, { up: true, right: true, brake: true }];
  for (const input of inputs) {
    const cardinal = makeGame(), camera = makeGame();
    cardinal.interact(); camera.interact();
    advance(cardinal, 0.5, input); advance(camera, 0.5, { ...input, moveAngle: Math.PI / 2 });
    assert.deepEqual(camera.current, cardinal.current);
    assert.deepEqual(camera.player, cardinal.player);
  }
});

test('building collisions do not leave a car clipping or stuck inside a building', () => {
  const game = makeGame(); game.interact(); game.graceTimer = 0;
  const car = game.current, building = game.buildings[0]; car.x = building.x - 70; car.y = building.y + building.h / 2; car.angle = 0;
  advance(game, 2, { up: true });
  assert.ok(game._isFree(game.current.x, game.current.y, 17.9));
  assert.ok(Number.isFinite(game.current.x));
  assert.ok(car.health < game.maxHealth);
  assert.ok(car.x < building.x);
});

test('fast exit is blocked and slow exit places player in free space', () => {
  const game = makeGame(); game.interact(); game.current.speed = 100;
  assert.equal(game.interact(), false); assert.ok(game.player.vehicleId);
  game.current.speed = 0; assert.equal(game.interact(), true);
  assert.equal(game.player.vehicleId, null); assert.ok(game._isFree(game.player.x, game.player.y, 10));
});

test('delivery advances pickup/dropoff and pays a single reward even in overtime', () => {
  const game = makeGame(); game.acceptMission('delivery');
  const originalMoney = game.money;
  let point = game.mission.targets[0]; game.player.x = point.x; game.player.y = point.y; game.update(1 / 60);
  assert.equal(game.mission.stage, 'dropoff'); assert.equal(game.mission.targetIndex, 1);
  game.mission.timeLeft = 0; game.missionStats.collisions = 3;
  point = game.mission.targets[1]; game.player.x = point.x; game.player.y = point.y; game.update(1 / 60);
  assert.equal(game.mission, null); assert.equal(game.money, originalMoney + 140); assert.equal(game.completed, 1);
  advance(game, 1); assert.equal(game.money, originalMoney + 140);
});

test('party markers require a car, slow speed, location, and a fresh horn press', () => {
  const game = makeGame(); game.acceptMission('party');
  assert.equal(game.horn(), false); assert.equal(game.mission.targetIndex, 0);
  game.player.x = 884; game.player.y = 1080; game.interact();
  const car = game.current, point = game.mission.targets[0]; car.x = point.x; car.y = point.y; car.speed = 100;
  game.horn(); assert.equal(game.mission.targetIndex, 0);
  game._hornCooldown = 0; car.speed = 0; game.horn(); assert.equal(game.mission.targetIndex, 1);
  game.horn(); assert.equal(game.mission.targetIndex, 1);
});

test('dash needs a vehicle and checkpoints must be reached in order', () => {
  const game = makeGame(); game.acceptMission('dash');
  const first = game.mission.targets[0]; game.player.x = first.x; game.player.y = first.y; game.update(1 / 60);
  assert.equal(game.mission.targetIndex, 0);
  game.player.x = 884; game.player.y = 1080; game.interact();
  const last = game.mission.targets[5]; game.current.x = last.x; game.current.y = last.y; game.update(1 / 60);
  assert.equal(game.mission.targetIndex, 0);
  game.current.x = first.x; game.current.y = first.y; game.update(1 / 60);
  assert.equal(game.mission.targetIndex, 1);
});

test('confetti startles residents without producing cash and particles are capped', () => {
  const game = makeGame(); const ped = game.peds[0];
  game.player.x = ped.x - 44; game.player.y = ped.y; const cash = game.money;
  assert.equal(game.action(0), true); assert.ok(ped.stunned > 0); assert.ok(ped.bubble.length); assert.equal(game.money, cash);
  for (let i = 0; i < 40; i++) game._confetti(900, 900, 50);
  assert.ok(game.particles.length <= 360);
});

test('police sight is blocked by buildings and a hidden player can cool heat', () => {
  const game = makeGame(); game.heat = 1; game.graceTimer = 0;
  game.buildings=[{x:240,y:240,w:240,h:240,height:6,angle:0.3}]; game.staticObjects=[]; game.cars=[]; game.peds=[];
  game.player.x = 180; game.player.y = 350;
  const cop = game.police[0]; cop.x = 540; cop.y = 350; cop.routeTimer = 999; cop.route = [{ x: 540, y: 350 }];
  game.update(1 / 60); assert.equal(game.policeSeen, false); assert.ok(game.escapeTimer > 0);
  cop.distracted = 100; advance(game, 14.1);
  assert.equal(game.heat, 0); assert.equal(game.escapeTimer, 0);
  assert.ok(game.drainEvents().some(e => e.type === 'toast' && e.text.includes('escaped')));
});

test('seen pursuit resets cooling and patrol count follows heat', () => {
  const game = makeGame(); game.heat = 3; game.escapeTimer = 10; game.graceTimer = 0;
  const cop = game.police[0]; cop.x = 900; cop.y = 1080; game.update(1 / 60);
  assert.equal(game.policeSeen, true); assert.equal(game.escapeTimer, 0); assert.equal(game.police.length, 3);
  game.heat = 0; game.update(1 / 60); assert.equal(game.police.length, 1);
});

test('recovery preserves cash and heat while moving a clipped vehicle to a safe road', () => {
  const game = makeGame(); game.interact(); const car = game.current; car.x = 350; car.y = 350; car.speed = 200;
  game.heat = 2; game.score = 50; const money = game.money; game.recover();
  assert.ok(game._isFree(car.x, car.y, 18)); assert.equal(car.speed, 0); assert.equal(game.score, 30); assert.equal(game.money, money); assert.equal(game.heat, 2); assert.equal(game.graceTimer, 2);
});

test('wreck safely ejects, and being caught preserves contracts and upgrades', () => {
  const game = makeGame(); game.interact(); const car = game.current; car.health = 1; game.graceTimer = 0; game._impact(car, 300, false);
  assert.equal(car.health, 0); assert.equal(game.player.vehicleId, null); assert.ok(game._isFree(game.player.x, game.player.y, 10));
  game.acceptMission('delivery'); game.upgrades.boost = 2; game.money = 25; game._caught();
  assert.equal(game.money, 0); assert.equal(game.heat, 0); assert.equal(game.upgrades.boost, 2); assert.ok(game.mission); assert.equal(game.player.composure, 100);
});

test('upgrades cap correctly and unsuccessful purchases never deduct money', () => {
  const game = makeGame(); const money = game.money; assert.equal(game.purchase('boost'), false); assert.equal(game.money, money);
  game.player.x = 900; game.player.y = 900; game.money = 10000;
  for (let i = 0; i < 3; i++) assert.equal(game.purchase('armor'), true);
  assert.equal(game.maxHealth, 175); const after = game.money; assert.equal(game.purchase('armor'), false); assert.equal(game.money, after);
  assert.equal(game.purchase('repair'), false);
});

test('garage purchases require proximity and use the displayed prices', () => {
  const game = makeGame(); game.money = 2000;
  assert.equal(game.purchase('armor'), false); assert.equal(game.money, 2000);
  game.player.x = 900; game.player.y = 900;
  assert.equal(game.purchase('armor'), true); assert.equal(game.money, 1850);
  assert.equal(game.purchase('boost'), true); assert.equal(game.money, 1650);
  assert.equal(game.purchase('boost'), true); assert.equal(game.money, 1300);
});

test('a stopped driver can wash without exiting; already clean rides can exit freely', () => {
  const game = makeGame(); game.interact(); const car = game.current;
  const wash = game.services.find(service=>service.id==='wash'); car.x = wash.x; car.y = wash.y; car.speed = 0; car.health = 40; game.heat = 2;
  assert.equal(game.interact(), true); assert.equal(game.money, 75); assert.equal(game.heat, 0); assert.equal(car.health, game.maxHealth); assert.equal(game.player.vehicleId, car.id);
  assert.equal(game.interact(), true); assert.equal(game.player.vehicleId, null); assert.equal(game.money, 75);
});

test('additional patrols spawn at distinct positions and recovery avoids occupied roads', () => {
  const game = makeGame(); game.heat = 3; game.update(1 / 60);
  assert.ok(Math.hypot(game.police[1].x - game.police[2].x, game.police[1].y - game.police[2].y) > 100);
  game.player.x = 350; game.player.y = 350;
  const road = game._roadPosition(game.player); game.cars[0].x = road.x; game.cars[0].y = road.y;
  game.recover(); assert.ok(Math.hypot(game.player.x - game.cars[0].x, game.player.y - game.cars[0].y) >= 33);
});

test('civilian traffic follows lanes and stops before a parked car', () => {
  const game = makeGame(), parked = game.cars[0], traffic = game.cars.find(car => car.traffic);
  traffic.x = 920; traffic.y = 1160; traffic.angle = -Math.PI / 2; traffic.speed = 100; traffic.route = [{ x: 920, y: 900 }];
  advance(game, 3);
  assert.ok(Math.hypot(traffic.x - parked.x, traffic.y - parked.y) >= 37.9);
  assert.ok(traffic.y > parked.y);
  const route = game._wanderRoute({ x: 540, y: 540 });
  assert.ok(route.length>3);
  assert.ok(route.some(point=>game.network.project(point).distance>5), 'route uses an actual driving lane');
  assert.ok(route.every(point=>game.network.project(point).distance<point.width/2), 'lane samples stay within the rendered road');
});

test('save data clamps malicious values and round-trips only persistent progress', () => {
  const game = makeGame();
  assert.equal(game.loadSave({ version: 1, money: 1e100, score: -9, bestScore: Infinity, completed: 12.8, upgrades: { boost: -2, armor: 900 } }), true);
  assert.equal(game.money, 999999); assert.equal(game.score, 0); assert.equal(game.bestScore, 0); assert.equal(game.completed, 12); assert.deepEqual(game.upgrades, { boost: 0, armor: 3 });
  assert.equal(game.loadSave(null), false); assert.equal(game.loadSave({ version: 99 }), false);
  const copy = makeGame(); assert.equal(copy.loadSave(game.exportSave()), true); assert.deepEqual(copy.exportSave(), game.exportSave());
  assert.equal(copy.player.vehicleId, null); assert.equal(copy.heat, 0); assert.ok(copy.player.x >= 0 && copy.player.x <= SIZE);
});

test('voluntary flop creates a jointed body and blocks walking, popping, and entering cars until get-up', () => {
  const idle = makeGame(), walking = makeGame();
  for (const game of [idle, walking]) { game.player.x = 1080; game.player.y = 900; assert.equal(game.flop(), true); }
  const body = walking.physics.get('player');
  assert.equal(walking.physics, walking.ragdolls); assert.equal(Object.keys(body.joints).length, 15); assert.equal(body.phase, 'fall');
  assert.equal(walking.flop(), false); assert.equal(walking.action(), false); assert.equal(walking.interact(), false);
  advance(idle, 1); advance(walking, 1, { up: true, right: true, boost: true });
  assert.equal(walking.player.x, idle.player.x); assert.equal(walking.player.y, idle.player.y);
  assert.deepEqual(walking.physics.get('player').joints, idle.physics.get('player').joints);
  advance(walking, 2.1); assert.equal(walking.physics.get('player').phase, 'recover');
  advance(walking, 0.9); assert.equal(walking.physics.get('player'), undefined); assert.equal(walking.player.stunned, 0);
  assert.ok(walking._personFree(walking.player.x, walking.player.y));
  const start = { ...walking.player }; advance(walking, 0.1, { up: true }); assert.ok(walking.player.y < start.y - 10);
});

test('recovery and capture clear a fallen player, preserve progress, and leave ragdolls out of saves', () => {
  const game = makeGame(); game.player.x = 1080; game.acceptMission('delivery'); game.money = 250; game.heat = 2; game.score = 50;
  assert.equal(game.flop(), true); const saved = game.exportSave();
  assert.deepEqual(Object.keys(saved).sort(), ['bestScore', 'completed', 'garage', 'inventory', 'money', 'score', 'upgrades', 'version']);
  const copy = makeGame(); copy.loadSave(saved); assert.equal(copy.physics.bodies.size, 0);
  game.recover(); assert.equal(game.physics.get('player'), undefined); assert.equal(game.money, 250); assert.equal(game.heat, 2); assert.ok(game.mission);
  assert.equal(game.score, 30); assert.ok(game._personFree(game.player.x, game.player.y));
  game.player.ragdollGrace = 0; assert.equal(game.flop(), true); game._caught();
  assert.equal(game.physics.get('player'), undefined); assert.equal(game.money, 200); assert.ok(game.mission); assert.equal(game.player.composure, 100);
});

test('confetti popper produces one physical resident tumble without rewarding cash or perpetual retriggers', () => {
  const game = makeGame(), ped = game.peds[0]; game.player.x = ped.x - 44; game.player.y = ped.y;
  const cash = game.money; assert.equal(game.action(0), true); const body = game.physics.get(ped.id); assert.ok(body);
  game.update(1 / 60); const age = body.age;
  game._actionCooldown = 0; game.action(0); assert.equal(game.physics.get(ped.id), body); assert.ok(body.age >= age); assert.equal(game.money, cash);
  advance(game, 4); assert.equal(game.physics.get(ped.id), undefined); assert.equal(ped.stunned, 0); assert.ok(ped.ragdollGrace > 0);
});

test('player cars, civilian traffic, and patrol cars knock standing residents into ragdolls', () => {
  for (const mode of ['player', 'traffic', 'police']) {
    const game = makeGame(), ped = game.peds[0];
    Object.assign(ped, { x: 932, y: 1080, homeX: 932, homeY: 1080, pace: 0 }); game.peds = [ped];
    game.cars = []; game.player.x = 1080; game.player.y = 1200;
    if (mode === 'police') {
      const cop = game.police[0]; Object.assign(cop, { x: 900, y: 1080, angle: 0, speed: 100, route: [{ x: 1260, y: 1080 }], routeTimer: 100 });
    } else {
      const car = game._addCar(900, 1080, 0, 'compact', '#ffd15b', mode === 'traffic');
      Object.assign(car, { speed: 100, vx: 100, vy: 0, route: [{ x: 1260, y: 1080 }] });
      if (mode === 'player') { game.player.vehicleId = car.id; game.player.x = car.x; game.player.y = car.y; }
    }
    const cash = game.money; advance(game, 0.25, mode === 'player' ? { up: true } : {});
    assert.ok(game.physics.get(ped.id), mode + ' car must trigger the resident body'); assert.equal(game.money, cash);
    assert.ok(ped.bubble); assert.ok(game.particles.length > 0);
    if (mode === 'player') assert.ok(game.heat > 0);
  }
});

test('moving traffic can knock the player down but post-recovery grace prevents immediate repeat falls', () => {
  const game = makeGame(); game.cars = []; game.peds = []; game.graceTimer = 0; game.player.x = 932;
  const car = game._addCar(900, 1080, 0, 'compact', '#ffd15b', true); car.speed = 100; car.route = [{ x: 1260, y: 1080 }];
  advance(game, 0.15); assert.ok(game.physics.get('player'));
  game.recover(); assert.equal(game.physics.get('player'), undefined);
  game.player.x = car.x + 28; game.player.y = car.y;
  game._vehiclePeople(car, 150, 0); assert.equal(game.physics.get('player'), undefined);
  assert.equal(game._personVehicleContact(game.player, car), null);
});

test('parked vehicles are solid on foot and standing residents cannot be walked through', () => {
  const game = makeGame(), car = game.cars[0]; game.peds = [];
  game.player.x = car.x - 60; game.player.y = car.y; advance(game, 0.8, { right: true });
  assert.equal(game._personVehicleContact(game.player, car), null); assert.ok(game.player.x <= car.x - 13.5 - PLAYER_RADIUS + 0.01);
  const ped = { id: 'test-resident', x: 1080, y: 900, angle: 0, homeX: 1080, homeY: 900, pace: 0, stunned: 0, bubbleTimer: 0 };
  game.buildings=[]; game.staticObjects=[]; game.cars=[]; game.police=[];
  game.peds = [ped]; game.player.x = 1040; game.player.y = 900; advance(game, 0.4, { right: true });
  assert.ok(Math.hypot(game.player.x - ped.x, game.player.y - ped.y) >= PLAYER_RADIUS + NPC_RADIUS - 0.01); assert.ok(game.player.x < ped.x);
});

test('vehicle OBB contacts detect front bumpers while leaving genuinely clear side gaps alone', () => {
  const game = makeGame(); game.cars = []; game.police = []; game.peds = [];
  const a = game._addCar(900, 1080, 0, 'sports', '#ffd15b'), b = game._addCar(940, 1080, 0, 'compact', '#fb8097');
  assert.ok(game._vehicleContact(a, b)); game._resolveVehicle(a); assert.equal(game._vehicleContact(a, b), null);
  assert.ok(b.x - a.x >= 47.499);
  a.x = b.x = 900; a.y = 1080; b.y = 1110;
  const before = { x: a.x, y: a.y }; assert.equal(game._resolveVehicle(a).collided, false); assert.deepEqual({ x: a.x, y: a.y }, before);
});

test('a bumper collision does not award the close-shave bonus, while a clear fast pass does', () => {
  for (const offset of [0, 40]) {
    const game = makeGame(); game.cars = []; game.peds = []; game.police = []; game.graceTimer = 0;
    // A four-unit bumper gap is clear before the step, but the fast car reaches
    // contact during it. Style must wait for the real solver's result.
    const car = game._addCar(900, 900, 0, 'compact', '#ffd15b'); game._addCar(950, 900 + offset, 0, 'compact', '#fb8097');
    game.player.vehicleId = car.id; car.speed = car.vx = 300;
    game.update(1 / 30, { up: true });
    assert.equal(game.score, offset ? 8 : 0); assert.equal(car.health < game.maxHealth, !offset);
  }
});

test('rotated vehicle footprints resolve building corners and boosted movement cannot tunnel through walls or people', () => {
  const game = makeGame(); game.cars = []; game.police = []; game.peds = [];
  // Keep this collision fixture independent from the changing neighbourhood map.
  game.buildings = [{ x: 240, y: 240, w: 240, h: 240, height: 6 }]; game.staticObjects = [];
  const car = game._addCar(225, 225, Math.PI / 4, 'van', '#ffd15b');
  assert.equal(game._vehicleFree(car), false); game._resolveVehicle(car); assert.ok(game._vehicleFree(car));
  Object.assign(car, { x: 180, y: 350, angle: 0 }); game._moveVehicle(car, 200, 0, 900, 0);
  assert.ok(game._vehicleFree(car)); assert.ok(car.x + 27.5 <= 240.001);
  Object.assign(car, { x: 900, y: 1080, angle: 0 });
  const ped = { id: 'swept-resident', x: 970, y: 1080, angle: 0, homeX: 970, homeY: 1080, pace: 0, stunned: 0, bubbleTimer: 0 }; game.peds = [ped];
  game._moveVehicle(car, 140, 0, 900, 0); assert.ok(game.physics.get(ped.id));
  for (const joint of Object.values(game.physics.get(ped.id).joints)) for (const key of ['x', 'y', 'z']) assert.ok(Number.isFinite(joint[key]));
});

test('downed bodies pause with the simulation and get up once even after repeated vehicle contacts', () => {
  const game = makeGame(); game.player.x = 1080; game.flop(); const body = game.physics.get('player');
  game.update(0); game.update(NaN); assert.equal(body.age, 0);
  const car = game.cars[0];
  for (let i = 0; i < 180; i++) { car.x = game.player.x; car.y = game.player.y; game._vehiclePeople(car, 200, 0); game.update(1 / 60); }
  advance(game, 2);
  assert.equal(game.physics.get('player'), undefined); assert.ok(game._personFree(game.player.x, game.player.y));
});
