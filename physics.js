(function (root) {
  'use strict';

  // Fifteen weighted Verlet particles form each person. Distances and joint
  // limits are solved against real town/vehicle volumes at a fixed 120 Hz.
  // Coordinates are metres: X/Z are the game's ground plane and Y points up.
  const STEP = 1 / 120, FLOOR = 0.05, UNIT = 20, MAX_SPEED = 22;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const ANATOMY = {
    pelvis: [0, 0.72, 0, 0.18, 0.5], chest: [0, 1.12, 0, 0.20, 0.45], head: [0.015, 1.48, 0, 0.23, 0.8],
    leftShoulder: [0, 1.17, -0.28, 0.095, 1], leftElbow: [0.015, 0.93, -0.34, 0.085, 1.4], leftHand: [0.04, 0.73, -0.36, 0.09, 1.6],
    rightShoulder: [0, 1.17, 0.28, 0.095, 1], rightElbow: [0.015, 0.93, 0.34, 0.085, 1.4], rightHand: [0.04, 0.73, 0.36, 0.09, 1.6],
    leftHip: [0, 0.66, -0.13, 0.10, 0.7], leftKnee: [0.025, 0.38, -0.13, 0.10, 1.2], leftFoot: [0.075, 0.165, -0.13, 0.115, 1.4],
    rightHip: [0, 0.66, 0.13, 0.10, 0.7], rightKnee: [0.025, 0.38, 0.13, 0.10, 1.2], rightFoot: [0.075, 0.165, 0.13, 0.115, 1.4]
  };
  const JOINT_NAMES = Object.keys(ANATOMY);
  const BODYPARTS = [
    ['pelvis', 'chest', 0.19, 'torso'], ['chest', 'head', 0.12, 'neck'],
    ['chest', 'leftShoulder', 0.10, 'shoulder'], ['chest', 'rightShoulder', 0.10, 'shoulder'],
    ['leftShoulder', 'leftElbow', 0.09, 'upperArm'], ['leftElbow', 'leftHand', 0.075, 'forearm'],
    ['rightShoulder', 'rightElbow', 0.09, 'upperArm'], ['rightElbow', 'rightHand', 0.075, 'forearm'],
    ['pelvis', 'leftHip', 0.12, 'hip'], ['pelvis', 'rightHip', 0.12, 'hip'],
    ['leftHip', 'leftKnee', 0.10, 'thigh'], ['leftKnee', 'leftFoot', 0.09, 'shin'],
    ['rightHip', 'rightKnee', 0.10, 'thigh'], ['rightKnee', 'rightFoot', 0.09, 'shin']
  ].map(([from, to, radius, kind]) => Object.freeze({ from, to, radius, kind }));
  const BRACES = [['leftShoulder', 'rightShoulder'], ['leftHip', 'rightHip'], ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftShoulder', 'rightHip'], ['rightShoulder', 'leftHip'], ['head', 'leftShoulder'], ['head', 'rightShoulder']];
  const BENDS = [['leftShoulder', 'leftHand', 0.18], ['rightShoulder', 'rightHand', 0.18], ['leftHip', 'leftFoot', 0.22], ['rightHip', 'rightFoot', 0.22], ['pelvis', 'head', 0.63]];
  const CAR_DIMENSIONS = { compact: [46, 27, 1.40], sports: [49, 28, 1.35], van: [55, 32, 1.64] };
  const vectorDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const restDistance = (a, b) => Math.hypot(ANATOMY[a][0] - ANATOMY[b][0], ANATOMY[a][1] - ANATOMY[b][1], ANATOMY[a][2] - ANATOMY[b][2]);

  function upright(x, z, angle) {
    const c = Math.cos(angle), s = Math.sin(angle), pose = {};
    for (const name of JOINT_NAMES) {
      const [lx, y, lz] = ANATOMY[name];
      pose[name] = { x: x + lx * c - lz * s, y, z: z + lx * s + lz * c };
    }
    return pose;
  }

  function limitVelocity(joint, maximum = MAX_SPEED) {
    let x = joint.x - joint.px, y = joint.y - joint.py, z = joint.z - joint.pz;
    const length = Math.hypot(x, y, z), maximumStep = maximum * STEP;
    if (length > maximumStep) {
      const scale = maximumStep / length; x *= scale; y *= scale; z *= scale;
      joint.px = joint.x - x; joint.py = joint.y - y; joint.pz = joint.z - z;
    }
  }

  function distanceConstraint(a, b, min, max, strength = 1) {
    let x = b.x - a.x, y = b.y - a.y, z = b.z - a.z;
    let length = Math.hypot(x, y, z);
    if (length >= min && length <= max) return;
    if (length < 0.000001) { x = 0.000001; y = 0; z = 0; length = 0.000001; }
    const target = clamp(length, min, max), factor = (length - target) / length * strength;
    const sum = a.invMass + b.invMass, wa = a.invMass / sum, wb = b.invMass / sum;
    a.x += x * factor * wa; a.y += y * factor * wa; a.z += z * factor * wa;
    b.x -= x * factor * wb; b.y -= y * factor * wb; b.z -= z * factor * wb;
  }

  // Sphere against a full 3D oriented box, including roofs. Local car X is
  // forward, as in core.js. Buildings use the same path with yaw zero.
  function sphereBox(point, radius, box) {
    const dx = point.x - box.x, dz = point.z - box.z;
    const lx = dx * box.c + dz * box.s, lz = -dx * box.s + dz * box.c;
    const ly = point.y - box.y;
    const qx = clamp(lx, -box.hx, box.hx), qy = clamp(ly, -box.hy, box.hy), qz = clamp(lz, -box.hz, box.hz);
    let nx = lx - qx, ny = ly - qy, nz = lz - qz, length = Math.hypot(nx, ny, nz), depth;
    if (length >= radius) return null;
    if (length > 0.000001) { nx /= length; ny /= length; nz /= length; depth = radius - length; }
    else {
      const sx = box.hx - Math.abs(lx), sy = box.hy - Math.abs(ly), sz = box.hz - Math.abs(lz);
      if (sx <= sy && sx <= sz) { nx = lx < 0 ? -1 : 1; ny = 0; nz = 0; depth = radius + sx; }
      else if (sy <= sz) { nx = 0; ny = ly < 0 ? -1 : 1; nz = 0; depth = radius + sy; }
      else { nx = 0; ny = 0; nz = lz < 0 ? -1 : 1; depth = radius + sz; }
    }
    return { x: nx * box.c - nz * box.s, y: ny, z: nx * box.s + nz * box.c, depth };
  }

  function horizontalBox(point, radius, box) {
    const dx = point.x - box.x, dz = point.z - box.z;
    const lx = dx * box.c + dz * box.s, lz = -dx * box.s + dz * box.c;
    let nx = lx - clamp(lx, -box.hx, box.hx), nz = lz - clamp(lz, -box.hz, box.hz);
    const length = Math.hypot(nx, nz);
    if (length >= radius) return null;
    let depth;
    if (length > 0.000001) { nx /= length; nz /= length; depth = radius - length; }
    else if (box.hx - Math.abs(lx) < box.hz - Math.abs(lz)) { nx = lx < 0 ? -1 : 1; nz = 0; depth = radius + box.hx - Math.abs(lx); }
    else { nx = 0; nz = lz < 0 ? -1 : 1; depth = radius + box.hz - Math.abs(lz); }
    return { x: nx * box.c - nz * box.s, z: nx * box.s + nz * box.c, depth };
  }

  function contactVelocity(j, normal, box, friction = 0.06, bounce = 0.10) {
    let vx = (j.x - j.px) / STEP - box.vx, vy = (j.y - j.py) / STEP, vz = (j.z - j.pz) / STEP - box.vz;
    const into = vx * normal.x + vy * normal.y + vz * normal.z;
    if (into < 0) { vx -= normal.x * into * (1 + bounce); vy -= normal.y * into * (1 + bounce); vz -= normal.z * into * (1 + bounce); }
    const outward = Math.max(0, vx * normal.x + vy * normal.y + vz * normal.z);
    vx = vx * (1 - friction) + normal.x * outward * friction + box.vx;
    vy = vy * (1 - friction) + normal.y * outward * friction;
    vz = vz * (1 - friction) + normal.z * outward * friction + box.vz;
    j.px = j.x - vx * STEP; j.py = j.y - vy * STEP; j.pz = j.z - vz * STEP;
    limitVelocity(j);
  }

  function projectJoint(j, boxes, size) {
    const ground = FLOOR + j.radius;
    if (j.y < ground) {
      const depth = ground - j.y; j.y += depth; j.py += depth;
      contactVelocity(j, { x: 0, y: 1, z: 0 }, { vx: 0, vz: 0 }, 0.12, 0.12);
    }
    for (const [axis, previous] of [['x', 'px'], ['z', 'pz']]) {
      const value = clamp(j[axis], j.radius, size - j.radius), delta = value - j[axis];
      if (delta) { j[axis] = value; j[previous] += delta; j[previous] = j[axis]; }
    }
    for (const box of boxes) {
      const normal = sphereBox(j, j.radius, box);
      if (!normal) continue;
      j.x += normal.x * normal.depth; j.y += normal.y * normal.depth; j.z += normal.z * normal.depth;
      j.px += normal.x * normal.depth; j.py += normal.y * normal.depth; j.pz += normal.z * normal.depth;
      contactVelocity(j, normal, box, box.dynamic ? 0.13 : 0.04, box.dynamic ? 0.20 : 0.06);
    }
  }

  function projectLimbs(body, boxes, size) {
    // Particle-only collision lets a shin cut through a corner. Two internal
    // samples on every physical bone distribute contacts to both endpoints.
    for (const part of BODYPARTS) {
      const a = body.joints[part.from], b = body.joints[part.to];
      for (const t of [1 / 3, 2 / 3]) {
        const u = 1 - t, sample = { x: a.x * u + b.x * t, y: a.y * u + b.y * t, z: a.z * u + b.z * t };
        let contacts = [];
        if (sample.y < FLOOR + part.radius) contacts.push({ x: 0, y: 1, z: 0, depth: FLOOR + part.radius - sample.y, box: { vx: 0, vz: 0 } });
        for (const box of boxes) {
          const hit = sphereBox(sample, part.radius, box);
          if (hit) { hit.box = box; contacts.push(hit); }
        }
        for (const hit of contacts) {
          const sum = a.invMass * u * u + b.invMass * t * t;
          const wa = a.invMass * u / sum, wb = b.invMass * t / sum;
          for (const [j, weight] of [[a, wa], [b, wb]]) {
            const dx = hit.x * hit.depth * weight, dy = hit.y * hit.depth * weight, dz = hit.z * hit.depth * weight;
            j.x += dx; j.y += dy; j.z += dz; j.px += dx; j.py += dy; j.pz += dz;
            contactVelocity(j, hit, hit.box, hit.box.dynamic ? 0.10 : 0.025, 0.05);
          }
        }
      }
    }
    for (const j of body._points) projectJoint(j, boxes, size);
  }

  class RagdollWorld {
    constructor(options = {}) {
      this.maxBodies = clamp(Math.floor(finite(options.maxBodies, 24)), 1, 64);
      this.bodies = new Map(); this._accumulator = 0; this._tick = 0;
    }

    get(id) { return this.bodies.get(id); }
    clear(id) { return this.bodies.delete(id); }
    clearAll() { this.bodies.clear(); this._accumulator = 0; }

    trigger(entity, impulse = {}, options = {}) {
      if (!entity || entity.id === undefined || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return false;
      const existing = this.bodies.get(entity.id);
      if (existing) {
        if (existing.age - existing.lastImpact < 0.28 || existing.phase === 'recover') return false;
        existing.lastImpact = existing.age;
        this._kick(existing, impulse, 0.40);
        return true;
      }
      if (this.bodies.size >= this.maxBodies) return false;
      const angle = finite(entity.angle), pose = upright(entity.x / UNIT, entity.y / UNIT, angle);
      const joints = {};
      for (const name of JOINT_NAMES) {
        const p = pose[name], anatomy = ANATOMY[name];
        joints[name] = { x: p.x, y: p.y + clamp(finite(options.height), 0, 8), z: p.z, px: p.x, py: p.y + clamp(finite(options.height), 0, 8), pz: p.z, radius: anatomy[3], invMass: anatomy[4] };
      }
      const constraints = BODYPARTS.concat(BRACES.map(([from, to]) => ({ from, to }))).map(part => ({ a: part.from, b: part.to, min: restDistance(part.from, part.to), max: restDistance(part.from, part.to) }));
      const bends = BENDS.map(([a, b, min]) => ({ a, b, min, max: restDistance(a, b) + 0.02 }));
      const body = { id: entity.id, owner: entity, angle, age: 0, phase: 'fall', recovery: 0, joints, standingPose: pose, lastImpact: 0, _points: JOINT_NAMES.map(name => joints[name]), _constraints: constraints, _bends: bends, _lastSafeX: entity.x / UNIT, _lastSafeZ: entity.y / UNIT };
      body._excluded = new Set(constraints.concat(bends).map(c => JOINT_NAMES.indexOf(c.a) + ':' + JOINT_NAMES.indexOf(c.b)));
      this.bodies.set(entity.id, body);
      this._kick(body, impulse, 1);
      return true;
    }

    _kick(body, impulse, strength) {
      let ix = clamp(finite(impulse.x), -18, 18) * strength, iy = clamp(finite(impulse.y), -2, 14) * strength, iz = clamp(finite(impulse.z), -18, 18) * strength;
      const horizontal = Math.hypot(ix, iz);
      if (horizontal > 18) { ix *= 18 / horizontal; iz *= 18 / horizontal; }
      for (const name of JOINT_NAMES) {
        const j = body.joints[name], anatomy = ANATOMY[name];
        // Differential impulse supplies actual angular momentum: a shoulder
        // catches more of the impact than a foot, and the two arms differ.
        const twist = anatomy[2] * 0.45, leverage = 0.72 + anatomy[1] * 0.35;
        const vx = ix * leverage + iz * twist, vz = iz * leverage - ix * twist;
        const vy = iy + (name.includes('Hand') ? 0.25 : 0) + horizontal * anatomy[2] * 0.12;
        j.px -= vx * STEP; j.py -= vy * STEP; j.pz -= vz * STEP; limitVelocity(j);
      }
    }

    _colliders(environment) {
      const boxes = [], buildings = environment.buildings || [], seen = new Set();
      buildings.forEach((building, i) => {
        const height = clamp(finite(building.height, [5.3, 7, 4.5, 6.2, 8.2][i % 5]) + 0.3, 0.4, 40);
        if (![building.x, building.y, building.w, building.h].every(Number.isFinite)) return;
        boxes.push({ x: (building.x + building.w / 2) / UNIT, z: (building.y + building.h / 2) / UNIT, y: height / 2, hx: building.w / UNIT / 2, hy: height / 2, hz: building.h / UNIT / 2, c: 1, s: 0, vx: 0, vz: 0, dynamic: false });
      });
      for (const car of (environment.cars || []).concat(environment.police || [])) {
        if (!car || !Number.isFinite(car.x) || !Number.isFinite(car.y) || seen.has(car.id || car)) continue;
        seen.add(car.id || car);
        const dimension = CAR_DIMENSIONS[car.kind] || CAR_DIMENSIONS.compact;
        const angle = finite(car.angle), length = clamp(finite(car.colliderLength, finite(car.length, dimension[0])), 10, 120) / UNIT;
        const width = clamp(finite(car.colliderWidth, finite(car.width, dimension[1])), 8, 80) / UNIT;
        const height = clamp(finite(car.colliderHeight, dimension[2]), 0.5, 4), c = Math.cos(angle), s = Math.sin(angle);
        boxes.push({ x: car.x / UNIT, z: car.y / UNIT, y: (height + 0.13) / 2, hx: length / 2, hy: (height - 0.13) / 2, hz: width / 2, c, s, vx: clamp(finite(car.vx, finite(car.speed) * c) / UNIT, -20, 20), vz: clamp(finite(car.vy, finite(car.speed) * s) / UNIT, -20, 20), dynamic: true });
      }
      return boxes;
    }

    _nearby(body, boxes) {
      const p = body.joints.pelvis;
      return boxes.filter(box => Math.abs(p.x - box.x) <= box.hx + box.hz + 3 && Math.abs(p.z - box.z) <= box.hx + box.hz + 3);
    }

    _recovery(body, boxes, size) {
      const pelvis = body.joints.pelvis;
      // Choose a standing centre near the landed pelvis, with shoulder-width
      // clearance. This also lets a character stand beside a stopped car.
      const centre = { x: clamp(pelvis.x, 0.45, size - 0.45), y: 0.72, z: clamp(pelvis.z, 0.45, size - 0.45) };
      for (let pass = 0; pass < 3; pass++) for (const box of boxes) {
        const hit = horizontalBox(centre, 0.43, box);
        if (!hit) continue;
        centre.x += hit.x * hit.depth; centre.z += hit.z * hit.depth;
      }
      body.standingPose = upright(centre.x, centre.z, body.angle);
      const amount = 1 - Math.exp(-STEP * (12 + body.recovery * 34));
      for (const name of JOINT_NAMES) {
        const j = body.joints[name], target = body.standingPose[name];
        const dx = (target.x - j.x) * amount, dy = (target.y - j.y) * amount, dz = (target.z - j.z) * amount;
        j.x += dx; j.y += dy; j.z += dz;
        // Recovery is a damped physical motor, still followed by constraints
        // and collisions; it never bypasses the contact solver for a pose.
        j.px += dx; j.py += dy; j.pz += dz;
        j.px = j.x - (j.x - j.px) * 0.80; j.py = j.y - (j.y - j.py) * 0.80; j.pz = j.z - (j.z - j.pz) * 0.80;
      }
    }

    _selfContacts(body) {
      const points = body._points;
      for (let i = 0; i < points.length; i++) for (let k = i + 1; k < points.length; k++) {
        if (body._excluded.has(i + ':' + k) || body._excluded.has(k + ':' + i)) continue;
        const a = points[i], b = points[k], min = (a.radius + b.radius) * 0.76;
        if (vectorDistance(a, b) < min) distanceConstraint(a, b, min, Infinity, 0.65);
      }
    }

    _bodyContacts(bodies) {
      for (let i = 0; i < bodies.length; i++) for (let k = i + 1; k < bodies.length; k++) {
        const a = bodies[i], b = bodies[k];
        if (vectorDistance(a.joints.pelvis, b.joints.pelvis) > 2.1) continue;
        for (const ja of a._points) for (const jb of b._points) {
          const radius = ja.radius + jb.radius;
          if (vectorDistance(ja, jb) < radius) distanceConstraint(ja, jb, radius, Infinity, 0.6);
        }
      }
    }

    _simulate(boxes, size) {
      const bodies = Array.from(this.bodies.values());
      for (const body of bodies) {
        body.age += STEP; body.phase = body.age + 1e-8 < 3 ? 'fall' : 'recover';
        body.recovery = body.phase === 'recover' ? clamp((body.age - 3) / 0.8, 0, 1) : 0;
        body._near = this._nearby(body, boxes);
        for (const j of body._points) {
          if (![j.x, j.y, j.z, j.px, j.py, j.pz].every(Number.isFinite)) {
            const p = upright(body._lastSafeX, body._lastSafeZ, body.angle)[JOINT_NAMES[body._points.indexOf(j)]];
            j.x = j.px = p.x; j.y = j.py = p.y; j.z = j.pz = p.z;
          }
          limitVelocity(j);
          const vx = (j.x - j.px) * 0.997, vy = (j.y - j.py) * 0.997, vz = (j.z - j.pz) * 0.997;
          j.px = j.x; j.py = j.y; j.pz = j.z;
          j.x += vx; j.y += vy - 9.81 * STEP * STEP; j.z += vz;
        }
        if (body.phase === 'recover') this._recovery(body, body._near, size);
      }
      for (let iteration = 0; iteration < 6; iteration++) {
        for (const body of bodies) {
          for (const c of body._constraints) distanceConstraint(body.joints[c.a], body.joints[c.b], c.min, c.max);
          for (const c of body._bends) distanceConstraint(body.joints[c.a], body.joints[c.b], c.min, c.max, 0.7);
          this._selfContacts(body);
          if (iteration === 2 || iteration === 5) projectLimbs(body, body._near, size);
          else for (const j of body._points) projectJoint(j, body._near, size);
        }
        if (iteration === 2) this._bodyContacts(bodies);
      }
      this._tick++;
      for (const body of bodies) {
        const p = body.joints.pelvis;
        body._lastSafeX = p.x; body._lastSafeZ = p.z;
        body.owner.x = p.x * UNIT; body.owner.y = p.z * UNIT;
        for (const j of body._points) limitVelocity(j);
      }
    }

    step(dt, environment = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return [];
      this._accumulator += Math.min(dt, 0.25);
      const boxes = this._colliders(environment), size = clamp(finite(environment.size, 2160) / UNIT, 4, 1000), finished = [];
      while (this._accumulator + 1e-10 >= STEP) {
        this._simulate(boxes, size); this._accumulator -= STEP;
        for (const [id, body] of this.bodies) {
          if (body.age + 1e-8 >= 3.8) { this.bodies.delete(id); finished.push(body); }
        }
      }
      return finished;
    }
  }

  const api = { RagdollWorld, BODYPARTS, JOINT_NAMES, STEP, FLOOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MayhemPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
