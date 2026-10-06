'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, ROAD_CENTERS, ROAD_WIDTH, SIDEWALK_WIDTH, BUILDING_SETBACK, DISTRICTS, districtAt } = require('../core.js');
const { NPC_RADIUS, PLAYER_RADIUS } = require('../physics.js');
const makeGame = () => new Game({ seed: 42 });
const overlaps = (a,b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test('the deterministic map has four identifiable districts and keeps its street grid and park', () => {
  const a = makeGame(), b = new Game({ seed: 999 });
  assert.deepEqual(a.blocks, b.blocks); assert.deepEqual(a.staticObjects, b.staticObjects);
  assert.equal(a.blocks.length, 25); assert.equal(a.buildings.length, 58);
  assert.deepEqual(ROAD_CENTERS, [180,540,900,1260,1620,1980]); assert.equal(ROAD_WIDTH, 104);
  assert.equal(SIDEWALK_WIDTH, 32); assert.equal(BUILDING_SETBACK, 84);
  assert.deepEqual(Object.values(DISTRICTS).map(d => d.name), ['Biscuit Heights','Waffle Works','Market Mile','Riverfront']);
  for (const [point,id] of [[{x:360,y:360},'heights'],[{x:1440,y:360},'works'],[{x:1080,y:720},'market'],[{x:1080,y:1800},'riverfront']]) {
    assert.equal(districtAt(point).id,id); assert.equal(a.districtAt(point),DISTRICTS[id]);
  }
  const park = a.blocks.find(block => block.row === 2 && block.col === 2);
  assert.equal(park.kind,'park'); assert.equal(park.buildings.length,0);
});

test('actual footprints vary and leave wide sidewalks plus traversable interior gaps', () => {
  const game = makeGame(), footprints = new Set();
  for (const block of game.blocks) for (const building of block.buildings) {
    footprints.add(building.w + 'x' + building.h);
    assert.ok(building.x - block.x >= BUILDING_SETBACK);
    assert.ok(building.y - block.y >= BUILDING_SETBACK);
    assert.ok(block.x + 360 - building.x - building.w >= BUILDING_SETBACK);
    assert.ok(block.y + 360 - building.y - building.h >= BUILDING_SETBACK);
    assert.ok(building.height >= 3 && building.height <= 14);
    assert.equal(building.district,block.district); assert.equal(building.blockId,block.id);
    for (const other of block.buildings) if (other !== building) assert.equal(overlaps(building,other),false);
  }
  assert.ok(footprints.size >= 12);
  for (const block of game.blocks.filter(block => block.kind === 'shops')) {
    const gap = block.courtyard;
    assert.ok(game._isFree(gap.x + gap.w / 2,gap.y + gap.h / 2,PLAYER_RADIUS));
    assert.ok(gap.h > PLAYER_RADIUS * 2, 'central shop courtyards fit a standing player');
  }
});

test('dense shops, warehouses, garden homes and open river courts have meaningfully different coverage', () => {
  const game = makeGame(), average = kind => {
    const blocks = game.blocks.filter(block => block.kind === kind);
    return blocks.reduce((sum,block) => sum + block.density,0) / blocks.length;
  };
  assert.ok(average('shops') > average('garden') * 1.65);
  assert.ok(average('yard') > average('garden') * 1.3);
  assert.ok(average('court') < average('garden') * 0.4);
  assert.ok(average('cafe') < average('garden'));
  const tower = game.buildings.find(building => building.style === 'tower');
  assert.equal(tower.district,'market'); assert.ok(tower.height > 12);
  assert.ok(game.buildings.filter(building => building.district === 'riverfront').every(building => building.height < 5));
});

test('starter vehicles, garage, wash and all existing contract destinations stay accessible', () => {
  const game = makeGame();
  assert.equal(game.cars.length,22); assert.equal(game.cars.filter(car => car.traffic).length,13);
  assert.equal(game.peds.length,36); assert.deepEqual([game.player.x,game.player.y],[884,1080]);
  assert.deepEqual([game.cars[0].x,game.cars[0].y],[916,1080]);
  assert.ok(game._personFree(game.player.x,game.player.y,PLAYER_RADIUS)); assert.equal(game.interact(),true);
  for (const vehicle of game._vehicles()) assert.ok(game._vehicleFree(vehicle));
  const destinations = game.services.slice();
  for (const type of ['delivery','dash','party']) {
    game.abandonMission(); game.acceptMission(type); destinations.push(...game.mission.targets);
  }
  for (const point of destinations) for (const angle of [0,Math.PI / 4,Math.PI / 2]) {
    assert.ok(game._vehicleFree({ ...point, kind:'van', angle }), 'a full-size van can reach ' + point.x + ',' + point.y);
  }
});

test('new shared props occupy clear lots and sidewalks while respecting driving lanes', () => {
  const game = makeGame(), mapped = game.staticObjects.filter(object => object.blockId);
  assert.ok(mapped.some(object => object.kind === 'planter')); assert.ok(mapped.some(object => object.kind === 'bollard'));
  assert.equal(mapped.filter(object => object.kind === 'wayfinding').length,4);
  for (const object of mapped) for (const part of object.parts) {
    const footprint = { x: object.x + (part.offset[0] - part.half[0]) * 20, y: object.y + (part.offset[2] - part.half[2]) * 20,
      w: part.half[0] * 40, h: part.half[2] * 40 };
    assert.ok(game.buildings.every(building => !overlaps(footprint,building)), object.id + ' avoids buildings');
    for (const road of ROAD_CENTERS) {
      assert.ok(footprint.x + footprint.w <= road - ROAD_WIDTH / 2 || footprint.x >= road + ROAD_WIDTH / 2, object.id + ' clears vertical roads');
      assert.ok(footprint.y + footprint.h <= road - ROAD_WIDTH / 2 || footprint.y >= road + ROAD_WIDTH / 2, object.id + ' clears horizontal roads');
    }
  }
});

test('pedestrians start safely on broad sidewalks with busier market streets', () => {
  const game = makeGame(), perBlock = district => game.peds.filter(ped => ped.district === district).length / game.blocks.filter(block => block.district === district).length;
  assert.ok(perBlock('market') > perBlock('heights')); assert.ok(perBlock('market') > perBlock('works') * 2);
  assert.ok(perBlock('riverfront') < 1);
  for (const ped of game.peds) {
    assert.ok(game._personFree(ped.x,ped.y,NPC_RADIUS));
    const crossing = ped.walkAxis === 'y' ? ped.x : ped.y;
    const offset = Math.min(...ROAD_CENTERS.map(road => Math.abs(crossing - road)));
    assert.ok(offset >= ROAD_WIDTH / 2 + NPC_RADIUS && offset <= BUILDING_SETBACK - NPC_RADIUS);
    for (const other of game.peds) if (other !== ped) assert.ok(Math.hypot(ped.x-other.x,ped.y-other.y) > NPC_RADIUS * 2);
  }
});

test('normal wandering follows sidewalk lanes without entering roads or new solids', () => {
  const game = makeGame(); game.cars = []; game.police = [];
  for (let frame = 0; frame < 600; frame++) game.update(1 / 60);
  for (const ped of game.peds) {
    assert.ok(game._isFree(ped.x,ped.y,NPC_RADIUS));
    const crossing = ped.walkAxis === 'y' ? ped.x : ped.y;
    assert.ok(Math.min(...ROAD_CENTERS.map(road => Math.abs(crossing-road))) >= ROAD_WIDTH / 2 + NPC_RADIUS - 0.01);
  }
});
