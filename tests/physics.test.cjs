const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { RagdollWorld, BODYPARTS, JOINT_NAMES, STEP, FLOOR } = require('../physics.js');

const entity = (id = 'person', x = 1000, y = 1000, angle = 0) => ({ id, x, y, angle });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const advance = (world, seconds, environment = {}, dt = 1 / 60) => {
  const completed = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) completed.push(...world.step(dt, environment));
  return completed;
};
const allFinite = body => {
  for (const joint of Object.values(body.joints)) for (const field of ['x', 'y', 'z', 'px', 'py', 'pz']) assert.ok(Number.isFinite(joint[field]), field);
};
function clearance(joint, box) {
  const c = Math.cos(box.angle || 0), s = Math.sin(box.angle || 0), x = joint.x - box.x, z = joint.z - box.z;
  const lx = x * c + z * s, lz = -x * s + z * c;
  return Math.hypot(lx - Math.max(-box.hx, Math.min(box.hx, lx)), joint.y - Math.max(box.bottom || 0, Math.min(box.top, joint.y)), lz - Math.max(-box.hz, Math.min(box.hz, lz)));
}

test('weighted articulated body has real gravity and differential angular response', () => {
  const world = new RagdollWorld(), person = entity();
  assert.equal(world.trigger(person, { x: 4, y: 0, z: 1 }, { height: 4 }), true);
  const body = world.get(person.id), initial = structuredClone(body.joints);
  advance(world, 0.2);
  allFinite(body);
  assert.ok(body.joints.pelvis.y < initial.pelvis.y - 0.12, 'gravity drops an airborne pelvis');
  assert.ok(body.joints.head.x - initial.head.x > body.joints.leftFoot.x - initial.leftFoot.x + 0.05, 'impact rotates the joint frame');
  assert.equal(person.x, body.joints.pelvis.x * 20);
  assert.equal(person.y, body.joints.pelvis.z * 20);
});

test('constraints keep connected limbs bounded during tumble and floor bounce', () => {
  const world = new RagdollWorld(), person = entity();
  world.trigger(person, { x: 9, y: 4, z: 5 });
  const body = world.get(person.id), lengths = BODYPARTS.map(part => distance(body.joints[part.from], body.joints[part.to]));
  let maximumError = 0;
  for (let i = 0; i < 330; i++) {
    world.step(STEP);
    allFinite(body);
    BODYPARTS.forEach((part, k) => { maximumError = Math.max(maximumError, Math.abs(distance(body.joints[part.from], body.joints[part.to]) - lengths[k])); });
    for (const joint of Object.values(body.joints)) assert.ok(joint.y >= FLOOR + joint.radius - 1e-7, 'joint clears floor');
  }
  assert.ok(maximumError < 0.11, `maximum limb stretch ${maximumError}`);
  const heights = Object.values(body.joints).map(j => j.y);
  assert.ok(Math.max(...heights) < 0.9, 'person tumbles down rather than freezing upright');
});

test('building walls and roofs exclude joint spheres and bone interior samples', () => {
  const world = new RagdollWorld(), person = entity('wall', 995, 1050);
  const building = { x: 1000, y: 1000, w: 100, h: 100, height: 5.3 };
  const box = { x: 52.5, z: 52.5, hx: 2.5, hz: 2.5, top: 5.6 };
  world.trigger(person, { x: 9, y: 3, z: 0 });
  const body = world.get(person.id);
  for (let i = 0; i < 300; i++) {
    world.step(STEP, { buildings: [building] });
    for (const j of Object.values(body.joints)) assert.ok(clearance(j, box) >= j.radius - 0.002, 'sphere does not enter wall');
    for (const part of BODYPARTS) for (const t of [1 / 3, 2 / 3]) {
      const a = body.joints[part.from], b = body.joints[part.to];
      const p = { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t, z: a.z * (1 - t) + b.z * t };
      assert.ok(clearance(p, box) >= part.radius - 0.035, 'bone interior clears wall');
    }
  }
});

test('rotated vehicle contacts clear full 3D volume without axis-aligned shortcuts', () => {
  const angle = Math.PI / 4, world = new RagdollWorld(), person = entity('car', 1000, 1000);
  const car = { id: 'parked', x: 1000, y: 1000, angle, kind: 'compact', vx: 0, vy: 0 };
  const box = { x: 50, z: 50, hx: 46 / 40, hz: 27 / 40, bottom: 0.13, top: 1.4, angle };
  world.trigger(person, { x: 2, y: 0, z: -2 }, { height: 2 });
  const body = world.get(person.id);
  for (let i = 0; i < 320; i++) {
    world.step(STEP, { cars: [car] });
    allFinite(body);
    for (const joint of Object.values(body.joints)) assert.ok(clearance(joint, box) >= joint.radius - 0.002, 'sphere clears rotated body/roof');
  }
});

test('moving vehicle transfers velocity into fallen articulated limbs', () => {
  const run = moving => {
    const world = new RagdollWorld(), person = entity('hit', 1000, 1000);
    world.trigger(person, { x: 1, y: 1, z: 0 });
    advance(world, 1.6);
    const body = world.get(person.id), start = body.joints.pelvis.x;
    const car = { id: 'impact', kind: 'compact', x: (start - 1.65) * 20, y: person.y, angle: 0, vx: moving ? 140 : 0, vy: 0 };
    for (let i = 0; i < 40; i++) { if (moving) car.x += car.vx * STEP; world.step(STEP, { cars: [car] }); }
    allFinite(body);
    return body.joints.pelvis.x - start;
  };
  assert.ok(run(true) > run(false) + 0.7, 'moving car pushes a downed body along its direction');
});

test('physical recovery returns near landing location and retires body once', () => {
  const world = new RagdollWorld(), person = entity();
  world.trigger(person, { x: 4, y: 2, z: 1 });
  const body = world.get(person.id);
  advance(world, 2.9);
  const landed = { ...body.joints.pelvis };
  advance(world, 0.2);
  assert.equal(body.phase, 'recover');
  assert.ok(body.recovery > 0);
  const completed = advance(world, 0.7);
  assert.equal(completed.length, 1);
  assert.equal(completed[0], body);
  assert.equal(world.get(person.id), undefined);
  assert.ok(body.joints.pelvis.y > 0.60, 'get-up motor lifts pelvis');
  assert.ok(body.joints.head.y > 1.30, 'get-up motor returns upright');
  assert.ok(Math.hypot(body.joints.pelvis.x - landed.x, body.joints.pelvis.z - landed.z) < 0.6, 'recovery stays at landing');
  assert.deepEqual(world.step(1 / 60), []);
});

test('a body that lands on a parked roof gets up beside the car', () => {
  const world = new RagdollWorld(), person = entity('roof'), car = { id: 'parked', x: 1000, y: 1000, angle: 0, kind: 'compact' };
  world.trigger(person, {}, { height: 2 });
  const body = world.get(person.id);
  advance(world, 3.8, { cars: [car] });
  assert.equal(world.bodies.size, 0);
  assert.ok(Math.abs(body.joints.pelvis.x - 50) > 1.15 || Math.abs(body.joints.pelvis.z - 50) > 0.675, 'ground position leaves the vehicle footprint');
  assert.ok(body.joints.pelvis.y < 1, 'body returns to ground height before retiring');
});

test('capacity, retrigger cooldown, and sanitization bound repeated impacts', () => {
  const world = new RagdollWorld({ maxBodies: 2 }), a = entity('a'), b = entity('b', 1500), c = entity('c');
  assert.equal(world.trigger(a, { x: Infinity, y: NaN, z: -1e300 }), true);
  assert.equal(world.trigger(a, { x: 10 }), false);
  world.trigger(b, {});
  assert.equal(world.trigger(c, {}), false);
  assert.equal(world.trigger({ id: 'bad', x: NaN, y: 100 }), false);
  const body = world.get('a');
  advance(world, 0.3);
  const age = body.age;
  assert.equal(world.trigger(a, { x: 2, y: 2 }), true);
  assert.equal(body.age, age, 'new impact does not extend recovery duration');
  body.joints.head.x = NaN;
  world.step(STEP); allFinite(body);
  assert.deepEqual(world.step(NaN), []);
  assert.deepEqual(world.step(-1), []);
  assert.equal(world.clear('b'), true);
  assert.equal(world.trigger(c, {}), true);
  world.clearAll(); assert.equal(world.bodies.size, 0);
});

test('fixed-step result is independent of 30, 60, and 120 Hz outer frames', () => {
  const simulate = dt => {
    const world = new RagdollWorld();
    world.trigger(entity(), { x: 5, y: 3, z: -2 });
    advance(world, 2.5, {}, dt);
    return JOINT_NAMES.map(name => Object.values(world.get('person').joints[name]));
  };
  assert.deepEqual(simulate(1 / 30), simulate(1 / 60));
  assert.deepEqual(simulate(1 / 60), simulate(1 / 120));
});

test('twenty-four simultaneous bodies remain finite with town broadphase', t => {
  const world = new RagdollWorld(), buildings = [];
  for (let i = 0; i < 24; i++) {
    world.trigger(entity('stress-' + i, 300 + (i % 6) * 280, 300 + Math.floor(i / 6) * 360), { x: 4, y: 2, z: 1 });
    buildings.push({ x: 380 + (i % 6) * 280, y: 380 + Math.floor(i / 6) * 360, w: 100, h: 100 });
  }
  const started = performance.now();
  advance(world, 0.5, { buildings });
  const elapsed = performance.now() - started;
  assert.equal(world.bodies.size, 24);
  for (const body of world.bodies.values()) allFinite(body);
  t.diagnostic(`24 bodies / 60 solver ticks: ${elapsed.toFixed(0)} ms on this machine (diagnostic, no timing assertion)`);
});
