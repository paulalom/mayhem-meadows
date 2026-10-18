'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AlienSystem, TIMING } = require('../aliens.js');

function fixture() {
  const peds = Array.from({ length: 16 }, (_, i) => ({ id: 'ped-' + i, x: 5500 + i * 70, y: 3500 + i * 15,
    district: ['market', 'heights', 'willow', 'riverfront'][i % 4], pathId: 'path-' + i, pace: 20, grounded: true, stunned: 0 }));
  const game = { _seed: 42, peds, player: { id: 'player', x: 6000, y: 3500 }, aircraft: [], cars: [], police: [], buildings: [],
    world: { mapWidth: 12000, mapHeight: 8000, landscape: { airspace: { ceiling: 900 } } },
    pedPaths: peds.map(ped => ({ id: ped.pathId, points: [{ x: ped.x, y: ped.y }, { x: ped.x + 80, y: ped.y }] })),
    ragdolls: new Map(), _ground: () => 3, _dry: () => true, _personFree: () => true, _witnessReports: [] };
  const system = new AlienSystem(game);
  game.aliens = system;
  return { game, system };
}
function until(system, predicate, seconds = 120) {
  for (let i = 0; i < seconds * 60 && !predicate(); i++) system.step(1 / 60);
  assert.ok(predicate(), 'event reaches expected state: ' + system.saucer.phase);
}

test('four disguised visitors keep existing routes, spread across districts, and leave gameplay RNG alone', () => {
  const { game, system } = fixture(), visitors = game.peds.filter(ped => ped.alien);
  assert.equal(visitors.length, 4); assert.equal(new Set(visitors.map(ped => ped.district)).size, 4);
  assert.ok(visitors.every(ped => ped.disguised && ped.pathId && ped.pace === 20));
  assert.equal(game._seed, 42);
  assert.ok(system.nextVisit >= TIMING.firstMin && system.nextVisit <= TIMING.firstMax);
  const before = system.time; system.step(0); system.step(NaN); system.step(-1);
  assert.equal(system.time, before);
});

test('a complete edge arrival, beam lift, departure and safe return preserves the civilian population', () => {
  const { game, system } = fixture(), original = [...game.peds], phases = new Set();
  assert.ok(system.startVisit()); assert.equal(system.startVisit(), false);
  assert.ok(system.saucer.x < 0 || system.saucer.y < 0 || system.saucer.y > game.world.mapHeight);
  const target = game.peds.find(ped => ped.id === system.targetId);
  assert.ok(target && !target.alien && target !== game.player);
  game._witnessReports.push({ reporter: target }, { reporter: game.player });
  for (let i = 0; i < 120 * 60 && (system.saucer.visible || system.capture); i++) {
    system.step(1 / 60); phases.add(system.saucer.phase);
    if (system.capture?.visible) {
      assert.ok(!game.peds.includes(target));
      assert.ok(system.capture.elevation >= 3 && system.capture.elevation < system.saucer.elevation);
      assert.equal(game._witnessReports.length, 1);
    }
  }
  assert.ok(['approach', 'descend', 'beam', 'depart', 'idle'].every(phase => phases.has(phase)));
  assert.equal(system.capture, null); assert.equal(system.saucer.visible, false);
  assert.equal(game.peds.length, original.length); assert.deepEqual(new Set(game.peds), new Set(original));
  assert.equal(target.bubble, 'WORST TAXI EVER.'); assert.equal(target.elevation, 3);
  assert.ok(system.nextVisit > 60);
});

test('targets under rotated buildings, ragdolls, aliens and the player cannot be abducted', () => {
  const { game, system } = fixture();
  const target = game.peds.find(ped => !ped.alien);
  game.buildings = [{ x: target.x - 100, y: target.y - 30, w: 200, h: 60, angle: Math.PI / 4, elevation: 3, height: 8 }];
  assert.equal(system._openSky(target), false);
  game.buildings = []; game.ragdolls.set(target.id, {}); assert.equal(system._openSky(target), false);
  game.ragdolls.clear(); target.stunned = 1; assert.equal(system._openSky(target), false);
  assert.equal(system._openSky(game.peds.find(ped => ped.alien)), false);
  assert.equal(system._openSky(game.player), false);
  for (const ped of game.peds) ped.stunned = 1;
  assert.equal(system.startVisit(), false); assert.equal(system.saucer.visible, false);
});

test('deployed soldiers, military units and riding passengers cannot become UFO targets while civilians remain eligible', () => {
  const { game, system } = fixture();
  const civilian = { ...game.peds.find(ped => !ped.alien), id: 'civilian' };
  const protectedPeople = [
    { ...civilian, id: 'deployed-soldier', soldier: true, district: 'military' },
    { ...civilian, id: 'military-unit', militaryUnit: true },
    { ...civilian, id: 'truck-passenger', transportedBy: 'military-truck-1' }
  ];
  game.peds = [...protectedPeople];
  assert.ok(protectedPeople.every(person => system._openSky(person) === false));
  assert.equal(system.startVisit(), false); assert.equal(system.saucer.visible, false);
  assert.equal(system.capture, null); assert.equal(game.peds.length, 3);
  game.peds.push(civilian);
  assert.equal(system._openSky(civilian), true); assert.equal(system.startVisit(), true);
  assert.equal(system.targetId, civilian.id, 'the civilian remains the only eligible pickup');
  Object.assign(system.saucer, { x: civilian.x, y: civilian.y });
  assert.equal(system._takeResident(), true); assert.equal(system.capture.ped, civilian);
  assert.deepEqual(game.peds, protectedPeople, 'protected units remain in their simulation population');
});

test('the six original Northwatch personnel cannot receive civilian alien disguises before enlistment', () => {
  const { Game } = require('../core.js'), game = new Game({ seed: 42 });
  const guards = game.peds.filter(person => person.district === 'military');
  assert.equal(guards.length, 6); assert.ok(guards.every(guard => !guard.alien && !guard.disguised));
  // Alien population setup runs before SoldierSystem enlistment. Exercise
  // those original route identities with the enlistment flags still absent.
  const personnel = guards.map(({ soldier, militaryUnit, ...person }) => ({ ...person }));
  const civilian = { id: 'civilian-visitor', pathId: 'civilian-route', district: 'market', x: 5500, y: 3500 };
  const beforeEnlistment = { _seed: 42, peds: personnel.concat(civilian) };
  new AlienSystem(beforeEnlistment, { visitors: 20 });
  assert.ok(personnel.every(person => !person.alien && !person.disguised), 'military routes stay on the soldier model');
  assert.equal(civilian.alien, true); assert.equal(civilian.disguised, true, 'ordinary civilian routes still receive visitors');
});

test('an unavailable moving target cancels the visit without removing any residents', () => {
  const { game, system } = fixture(), count = game.peds.length;
  system.startVisit(); game.peds.find(ped => ped.id === system.targetId).stunned = 5;
  system.step(1 / 60); assert.equal(system.saucer.phase, 'depart');
  until(system, () => !system.saucer.visible);
  assert.equal(system.capture, null); assert.equal(game.peds.length, count);
});

test('nearby aircraft interrupt the beam and get vertical separation before departure', () => {
  const { game, system } = fixture();
  system.startVisit(); until(system, () => system.saucer.phase === 'beam');
  system.step(.25); const elevation = system.saucer.elevation;
  game.aircraft.push({ x: system.saucer.x, y: system.saucer.y, elevation, grounded: false, visible: true });
  system.step(1 / 60);
  assert.equal(system.saucer.yielding, true); assert.ok(system.saucer.elevation > elevation);
  assert.equal(system.saucer.phase, 'depart'); assert.equal(system.saucer.beam, 0); assert.equal(system.capture.visible, false);
  until(system, () => !system.saucer.visible && !system.capture);
  assert.equal(game.peds.length, 16);
});

test('return waits for a safe sidewalk, then restores the original resident exactly once', () => {
  const { game, system } = fixture();
  system.startVisit(); until(system, () => system.saucer.phase === 'beam');
  const target = system.capture.ped; game._personFree = () => false;
  until(system, () => !system.saucer.visible);
  for (let i = 0; i < 26 * 4; i++) system.step(.25);
  assert.ok(system.capture); assert.ok(!game.peds.includes(target));
  game._personFree = () => true; until(system, () => !system.capture, 3);
  assert.equal(game.peds.filter(ped => ped === target).length, 1);
});

test('flight clearance includes terrain and roofs, and fixtures without a landscape disable visits', () => {
  const { game, system } = fixture();
  game.buildings.push({ x: 3000, y: 3000, w: 100, h: 100, elevation: 20, height: 40 });
  assert.ok(system._clearance({ x: 0, y: 0 }, { x: 6000, y: 4000 }) >= 175);
  game.world = { size: 12000 };
  assert.equal(system.startVisit(), false); assert.equal(system.saucer.visible, false);
});

test('return does not put the abductee inside the player or another pedestrian', () => {
  const { game, system } = fixture();
  system.startVisit(); until(system, () => system.saucer.phase === 'beam');
  const capture = system.capture;
  Object.assign(game.player, capture.origin);
  const clear = { x: capture.origin.x + 200, y: capture.origin.y + 200 };
  game.pedPaths.find(path => path.id === capture.ped.pathId).points.push(clear);
  system._returnResident();
  assert.equal(system.capture, null);
  assert.ok(Math.hypot(capture.ped.x - game.player.x, capture.ped.y - game.player.y) >= 24);
  assert.equal(capture.ped.x, clear.x); assert.equal(capture.ped.y, clear.y);
});

test('approach and descent follow a walking target before beginning the lift', () => {
  const { game, system } = fixture();
  system.startVisit();
  const target = game.peds.find(ped => ped.id === system.targetId);
  for (let i = 0; i < 80 * 60 && !system.capture; i++) {
    target.x += Math.cos(i / 300) * 22 / 60;
    target.y += Math.sin(i / 300) * 22 / 60;
    system.step(1 / 60);
  }
  assert.ok(system.capture); assert.equal(system.saucer.phase, 'beam');
  assert.ok(Math.hypot(system.saucer.x - target.x, system.saucer.y - target.y) < 6);
});

test('a helicopter occupying the pickup point cancels a descent instead of waiting forever', () => {
  const { game, system } = fixture();
  system.startVisit();
  const target = game.peds.find(ped => ped.id === system.targetId);
  Object.assign(system.saucer, { x: target.x, y: target.y }); system._phase('descend');
  game.aircraft.push({ x: target.x, y: target.y, elevation: system._hoverHeight(target), grounded: false, visible: true });
  until(system, () => system.saucer.phase === 'depart', 40);
  assert.equal(system.capture, null); assert.equal(game.peds.length, 16);
});
