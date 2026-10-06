const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { RagdollWorld, BODYPARTS, JOINT_NAMES, STEP, FLOOR, CHARACTER_SCALE, PERSON_HEIGHT, MUZZLE_HEIGHT, PLAYER_RADIUS, NPC_RADIUS } = require('../physics.js');

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

function solidClearance(point, box) {
  const m = box.basis, x = point.x - box.x, y = point.y - box.y, z = point.z - box.z;
  const local = [x * m[0] + y * m[3] + z * m[6], x * m[1] + y * m[4] + z * m[7], x * m[2] + y * m[5] + z * m[8]];
  if (box.shape === 'cylinder') return Math.hypot(Math.max(0, Math.hypot(local[0], local[2]) - Math.max(box.hx, box.hz)), Math.max(0, Math.abs(local[1]) - box.hy));
  return Math.hypot(...local.map((value, i) => value - Math.max(-[box.hx, box.hy, box.hz][i], Math.min([box.hx, box.hy, box.hz][i], value))));
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
  assert.ok(maximumError < 0.11 * CHARACTER_SCALE, `maximum limb stretch ${maximumError}`);
  const heights = Object.values(body.joints).map(j => j.y);
  assert.ok(Math.max(...heights) < 0.9 * CHARACTER_SCALE, 'person tumbles down rather than freezing upright');
});

test('building walls and roofs exclude joint spheres and bone interior samples', () => {
  const world = new RagdollWorld(), person = entity('wall', 995, 1050);
  const building = { x: 1000, y: 1000, w: 100, h: 100, height: 5.3 };
  const box = { x: 52.5, z: 52.5, hx: 2.5, hz: 2.5, top: building.height };
  world.trigger(person, { x: 9, y: 3, z: 0 });
  const body = world.get(person.id);
  for (let i = 0; i < 300; i++) {
    world.step(STEP, { buildings: [building] });
    for (const j of Object.values(body.joints)) assert.ok(clearance(j, box) >= j.radius - 0.002, 'sphere does not enter wall');
    for (const part of BODYPARTS) for (const t of [1 / 3, 2 / 3]) {
      const a = body.joints[part.from], b = body.joints[part.to];
      const p = { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t, z: a.z * (1 - t) + b.z * t };
      assert.ok(clearance(p, box) >= part.radius - 0.035 * CHARACTER_SCALE, 'bone interior clears wall');
    }
  }
});

test('ragdoll roofs and Cannon landing surfaces share the complete building height', () => {
  const { VehicleWorld } = require('../vehicle-physics.js');
  const { CAR_TYPES } = require('../core.js');
  for (const height of [3.4, 13.4]) {
    const building = { x: 1000, y: 1000, w: 100, h: 100, height };
    const town = { buildings: [building], staticObjects: [], cars: [], police: [] };
    const vehicles = new VehicleWorld(town, CAR_TYPES), world = new RagdollWorld();
    const box = world._colliders(town)[0], roof = vehicles.support(1050, 1050, height + 2);
    assert.ok(Math.abs(roof - height) < 1e-10, 'Cannon lands on the full roof-inclusive height');
    assert.ok(Math.abs(box.y + box.hy - roof) < 1e-10, 'ragdoll roof has no legacy extra thirty centimetres');
    world.trigger(entity('roof-' + height, 1050, 1050), {}, { height: height + 1.6 });
    const body = world.get('roof-' + height);
    advance(world, 1.8, town);
    const lowest = Math.min(...Object.values(body.joints).map(joint => joint.y - joint.radius));
    assert.ok(lowest >= roof - 0.002 && lowest < roof + 0.02, 'a fallen body settles on the same surface as the standing controller');
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

test('jump-height ragdolls preserve their feet elevation and upward momentum', () => {
  const world = new RagdollWorld(), person = { ...entity('jump'), elevation: 2.4, verticalVelocity: 5 };
  world.trigger(person);
  const body = world.get(person.id), initial = body.joints.pelvis.y;
  assert.equal(initial, person.elevation + 0.72 * CHARACTER_SCALE);
  assert.equal(body.joints.leftFoot.y, person.elevation + 0.165 * CHARACTER_SCALE);
  advance(world, 0.1);
  assert.ok(body.joints.pelvis.y > initial + 0.25, 'airborne flop inherits jump velocity');
  advance(world, 3.7);
  assert.equal(world.bodies.size, 0);
  assert.equal(person.elevation, 0);
  assert.equal(person.verticalVelocity, 0);
});

test('a fully rolled, elevated vehicle excludes joints and limb interiors in its actual orientation', () => {
  const world = new RagdollWorld(), person = entity('rolled'), roll = Math.PI / 3;
  const car = { id: 'rolling', kind: 'compact', x: 1000, y: 1000, elevation: 0.75, colliderHeight: 1.3,
    orientation: { x: Math.sin(roll / 2), y: 0, z: 0, w: Math.cos(roll / 2) } };
  const box = world._colliders({ cars: [car] })[0];
  world.trigger(person, { x: 0.8, z: 0.5 }, { height: 3 });
  const body = world.get(person.id);
  let closest = Infinity;
  for (let i = 0; i < 310; i++) {
    world.step(STEP, { cars: [car] });
    allFinite(body);
    for (const joint of Object.values(body.joints)) {
      const separation = solidClearance(joint, box);
      closest = Math.min(closest, separation - joint.radius);
      assert.ok(separation >= joint.radius - 0.002, 'sphere clears a rolled body, not only its yaw footprint');
    }
    for (const part of BODYPARTS) for (const t of [1 / 3, 2 / 3]) {
      const a = body.joints[part.from], b = body.joints[part.to];
      const sample = { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t, z: a.z * (1 - t) + b.z * t };
      assert.ok(solidClearance(sample, box) >= part.radius - 0.035 * CHARACTER_SCALE, 'bone interior clears tipped vehicle');
    }
  }
  assert.ok(closest < 0.01, 'falling person actually meets the tipped car');
});

test('a high flying car does not collide with or redirect a grounded ragdoll', () => {
  const car = { id: 'overhead', kind: 'van', x: 1000, y: 1000, elevation: 4, colliderHeight: 1.7,
    orientation: { x: 0, y: 0, z: 0, w: 1 }, vx: 140, verticalVelocity: 2, angularVelocity: { x: 2, y: 0, z: 1 } };
  const run = cars => {
    const world = new RagdollWorld(), person = entity('ground');
    world.trigger(person, { x: 0.4, z: 0.2 });
    const body = world.get(person.id);
    advance(world, 3.8, { cars });
    return JOINT_NAMES.map(name => body.joints[name]);
  };
  assert.deepEqual(run([car]), run([]), 'both collision and get-up ignore an overhead volume');
});

test('rising and spinning vehicle surfaces transfer their full 3D contact velocity', () => {
  const velocity = (verticalVelocity, angularVelocity) => {
    const world = new RagdollWorld(), person = entity('surface', 1011, 1000);
    const car = { id: 'lift', kind: 'compact', x: 1000, y: 1000, elevation: 0, colliderHeight: 1.3,
      orientation: { x: 0, y: 0, z: 0, w: 1 }, verticalVelocity, angularVelocity };
    world.trigger(person, {}, { height: 0.86 });
    const body = world.get(person.id);
    world.step(STEP, { cars: [car] });
    return (body.joints.leftFoot.y - body.joints.leftFoot.py) / STEP;
  };
  assert.ok(velocity(6) > velocity(0) + 3, 'moving roof lifts contacting feet');
  assert.ok(velocity(0, { x: 0, y: 0, z: 8 }) > velocity(0) + 1.5, 'rolling roof adds angular contact motion');
});

test('compound fixed props exclude joint spheres and limb interiors', () => {
  const world = new RagdollWorld(), person = entity('bench', 976, 1000);
  const bench = { id: 'bench', kind: 'bench', x: 1000, y: 1000, parts: [
    { offset: [0, 0.48, 0], half: [0.8, 0.12, 0.3] },
    { offset: [0, 0.81, 0.23], half: [0.8, 0.33, 0.08] },
    { offset: [-0.58, 0.23, 0], half: [0.06, 0.23, 0.24] },
    { offset: [0.58, 0.23, 0], half: [0.06, 0.23, 0.24] }
  ] };
  const boxes = world._colliders({ staticObjects: [bench] });
  world.trigger(person, { x: 2.5, y: 2 });
  const body = world.get(person.id);
  let contact = false;
  for (let i = 0; i < 300; i++) {
    world.step(STEP, { staticObjects: [bench] });
    for (const box of boxes) {
      for (const joint of Object.values(body.joints)) {
        const gap = solidClearance(joint, box) - joint.radius;
        contact ||= gap < 0.01;
        assert.ok(gap >= -0.002, 'sphere clears fixed bench');
      }
      for (const part of BODYPARTS) for (const t of [1 / 3, 2 / 3]) {
        const a = body.joints[part.from], b = body.joints[part.to];
        const sample = { x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t, z: a.z * (1 - t) + b.z * t };
        assert.ok(solidClearance(sample, box) >= part.radius - 0.04 * CHARACTER_SCALE, 'limb interior clears fixed bench');
      }
    }
  }
  assert.ok(contact, 'the airborne body actually lands against the bench');
});

test('get-up chooses ground clearance beside a tipped vehicle', () => {
  const world = new RagdollWorld(), person = entity('tipped'), roll = Math.PI / 2;
  const car = { id: 'tipped-van', kind: 'van', x: 1000, y: 1000, elevation: 0.1, colliderHeight: 1.7,
    orientation: { x: Math.sin(roll / 2), y: 0, z: 0, w: Math.cos(roll / 2) } };
  const box = world._colliders({ cars: [car] })[0];
  world.trigger(person, {}, { height: 2 });
  const body = world.get(person.id);
  advance(world, 3.8, { cars: [car] });
  assert.equal(world.bodies.size, 0);
  assert.equal(person.elevation, 0);
  for (const joint of Object.values(body.joints)) assert.ok(solidClearance(joint, box) >= joint.radius - 0.002, 'recovered pose clears tipped body');
  assert.ok(body.joints.pelvis.y < CHARACTER_SCALE, 'recovered feet are on the ground');
});

test('round fixed posts collide as cylinders without filling their bounding-box corners', () => {
  const post = { id: 'post', kind: 'tree', x: 1000, y: 1000, parts: [{ shape: 'cylinder', offset: [0, 1.5, 0], half: [0.5, 1.5, 0.5] }] };
  const run = staticObjects => {
    const world = new RagdollWorld(), person = entity('corner', 1011, 1011);
    world.trigger(person);
    world.step(STEP, { staticObjects });
    return JOINT_NAMES.map(name => world.get(person.id).joints[name]);
  };
  assert.deepEqual(run([post]), run([]), 'a diagonal point clears the circular post, even inside its square bounds');
  const world = new RagdollWorld(), person = entity('trunk', 977, 1000);
  const box = world._colliders({ staticObjects: [post] })[0];
  world.trigger(person, { x: 4, y: 2 });
  const body = world.get(person.id);
  let contact = false;
  for (let i = 0; i < 220; i++) {
    world.step(STEP, { staticObjects: [post] });
    for (const joint of Object.values(body.joints)) {
      const gap = solidClearance(joint, box) - joint.radius;
      contact ||= gap < 0.01;
      assert.ok(gap >= -0.002, 'joint clears the real cylindrical trunk');
    }
  }
  assert.ok(contact, 'the body actually hits the post');
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
  assert.ok(body.joints.pelvis.y > 0.60 * CHARACTER_SCALE, 'get-up motor lifts pelvis');
  assert.ok(body.joints.head.y > 1.30 * CHARACTER_SCALE, 'get-up motor returns upright');
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
  assert.ok(body.joints.pelvis.y < CHARACTER_SCALE, 'body returns to ground height before retiring');
});

test('recovery leaves a high car roof before returning the owner to ground height', () => {
  const world = new RagdollWorld(), person = entity('high-roof');
  const car = { id: 'high-ride', kind: 'compact', x: 1000, y: 1000, elevation: 4, colliderHeight: 1.3, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const box = world._colliders({ cars: [car] })[0];
  world.trigger(person, {}, { height: 6 });
  const body = world.get(person.id);
  advance(world, 2.9, { cars: [car] });
  assert.ok(body.joints.pelvis.y > 5.2, 'the fixture actually lands on the elevated roof');
  const finished = advance(world, 0.9, { cars: [car] });
  assert.equal(finished.length, 1);
  assert.equal(person.elevation, 0);
  assert.ok(Math.abs(body.joints.pelvis.x - box.x) > box.hx || Math.abs(body.joints.pelvis.z - box.z) > box.hz, 'get-up chooses beside the high roof instead of underneath it');
  assert.ok(body.joints.pelvis.y < 0.95 * CHARACTER_SCALE, 'the get-up motor reaches the ground before retiring');
  assert.ok(body.joints.leftFoot.y < 0.35 * CHARACTER_SCALE && body.joints.rightFoot.y < 0.35 * CHARACTER_SCALE, 'feet finish at standing ground height');
  for (const joint of Object.values(body.joints)) assert.ok(solidClearance(joint, box) >= joint.radius - 0.002, 'final standing pose clears the elevated vehicle');
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

test('shared character dimensions make standing and articulated people fourteen percent smaller', () => {
  assert.equal(CHARACTER_SCALE, 0.86);
  assert.equal(PERSON_HEIGHT, 1.7 * CHARACTER_SCALE);
  assert.equal(MUZZLE_HEIGHT, 1.15 * CHARACTER_SCALE);
  assert.equal(PLAYER_RADIUS, 10 * CHARACTER_SCALE);
  assert.equal(NPC_RADIUS, 7 * CHARACTER_SCALE);
  const world = new RagdollWorld(), person = entity('player');
  world.trigger(person);
  const body = world.get(person.id), j = body.joints;
  assert.equal(j.pelvis.y, 0.72 * CHARACTER_SCALE);
  assert.equal(j.head.y, 1.48 * CHARACTER_SCALE);
  assert.ok(Math.abs(j.rightShoulder.z - j.leftShoulder.z - 0.56 * CHARACTER_SCALE) < 1e-12);
  assert.equal(j.head.radius, 0.23 * CHARACTER_SCALE);
  assert.equal(j.leftFoot.radius, 0.115 * CHARACTER_SCALE);
  assert.equal(j.leftHand.radius, 0.09 * CHARACTER_SCALE);
  assert.equal(BODYPARTS.find(part => part.kind === 'torso').radius, 0.19 * CHARACTER_SCALE);
  assert.ok(Math.abs(j.head.y + j.head.radius - PERSON_HEIGHT) < 0.02, 'head volume matches the shared standing height');
  assert.equal(j.pelvis.invMass, 0.5);
  assert.equal(j.leftFoot.invMass, 1.4);
  assert.equal(body._bends.find(bend => bend.a === 'pelvis').min, 0.63 * CHARACTER_SCALE);
});

test('character scaling leaves vehicle dimensions and supplied impact velocity unchanged', () => {
  const world = new RagdollWorld(), person = entity();
  world.trigger(person, { x: 4, y: 5 });
  const head = world.get(person.id).joints.head;
  assert.ok(Math.abs((head.x - head.px) / STEP - 4 * (0.72 + 1.48 * 0.35)) < 1e-10, 'differential hit weighting keeps its original feel');
  assert.ok(Math.abs((head.y - head.py) / STEP - 5) < 1e-10, 'jump and hit velocities stay in world metres per second');
  const box = world._colliders({ cars: [{ id: 'car', kind: 'compact', x: 1000, y: 1000, colliderHeight: 1.3, orientation: { x: 0, y: 0, z: 0, w: 1 } }] })[0];
  assert.equal(box.hx, 46 / 40);
  assert.equal(box.hy, 1.3 / 2);
  assert.equal(box.hz, 27 / 40);
});

test('smaller people recover beneath a low overhead vehicle without being displaced', () => {
  const car = { id: 'canopy', kind: 'compact', x: 1000, y: 1000, elevation: PERSON_HEIGHT + FLOOR + 0.03, colliderHeight: 1.3, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const run = cars => {
    const world = new RagdollWorld(), person = entity('player');
    world.trigger(person);
    const body = world.get(person.id);
    advance(world, 3.8, { cars });
    return JOINT_NAMES.map(name => body.joints[name]);
  };
  assert.deepEqual(run([car]), run([]), 'get-up uses the smaller standing height instead of the old head clearance');
});

test('player roof recovery leaves space for the shared standing collision radius', () => {
  const world = new RagdollWorld(), person = entity('player');
  const car = { id: 'roof', kind: 'compact', x: 1000, y: 1000, colliderHeight: 1.3, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  world.trigger(person, {}, { height: 2 });
  const body = world.get(person.id);
  advance(world, 3.8, { cars: [car] });
  const p = body.joints.pelvis, dx = Math.max(0, Math.abs(p.x - 50) - 46 / 40), dz = Math.max(0, Math.abs(p.z - 50) - 27 / 40);
  assert.ok(Math.hypot(dx, dz) >= PLAYER_RADIUS / 20 - 0.025, 'retired player clears the standing capsule as well as the small joint spheres');
  assert.equal(person.elevation, 0);
});
