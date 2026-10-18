(function (root) {
  'use strict';

  // Fifteen weighted Verlet particles form each person. Distances and joint
  // limits are solved against real town/vehicle volumes at a fixed 120 Hz.
  // Coordinates are metres: X/Z are the game's ground plane and Y points up.
  const STEP = 1 / 120, FLOOR = 0.05, UNIT = 20, MAX_SPEED = 22;
  // One character scale is shared by standing meshes, collision capsules,
  // aiming and articulated bodies. Metres for heights; map units for radii.
  const CHARACTER_SCALE = 0.86, PERSON_HEIGHT = 1.7 * CHARACTER_SCALE, MUZZLE_HEIGHT = 1.15 * CHARACTER_SCALE;
  const PLAYER_RADIUS = 10 * CHARACTER_SCALE, NPC_RADIUS = 7 * CHARACTER_SCALE;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const ANATOMY = Object.fromEntries(Object.entries({
    pelvis: [0, 0.72, 0, 0.18, 0.5], chest: [0, 1.12, 0, 0.20, 0.45], head: [0.015, 1.48, 0, 0.23, 0.8],
    leftShoulder: [0, 1.17, -0.28, 0.095, 1], leftElbow: [0.015, 0.93, -0.34, 0.085, 1.4], leftHand: [0.04, 0.73, -0.36, 0.09, 1.6],
    rightShoulder: [0, 1.17, 0.28, 0.095, 1], rightElbow: [0.015, 0.93, 0.34, 0.085, 1.4], rightHand: [0.04, 0.73, 0.36, 0.09, 1.6],
    leftHip: [0, 0.66, -0.13, 0.10, 0.7], leftKnee: [0.025, 0.38, -0.13, 0.10, 1.2], leftFoot: [0.075, 0.165, -0.13, 0.115, 1.4],
    rightHip: [0, 0.66, 0.13, 0.10, 0.7], rightKnee: [0.025, 0.38, 0.13, 0.10, 1.2], rightFoot: [0.075, 0.165, 0.13, 0.115, 1.4]
  }).map(([name, values]) => [name, values.map((value, i) => i < 4 ? value * CHARACTER_SCALE : value)]));
  const JOINT_NAMES = Object.keys(ANATOMY);
  const BODYPARTS = [
    ['pelvis', 'chest', 0.19, 'torso'], ['chest', 'head', 0.12, 'neck'],
    ['chest', 'leftShoulder', 0.10, 'shoulder'], ['chest', 'rightShoulder', 0.10, 'shoulder'],
    ['leftShoulder', 'leftElbow', 0.09, 'upperArm'], ['leftElbow', 'leftHand', 0.075, 'forearm'],
    ['rightShoulder', 'rightElbow', 0.09, 'upperArm'], ['rightElbow', 'rightHand', 0.075, 'forearm'],
    ['pelvis', 'leftHip', 0.12, 'hip'], ['pelvis', 'rightHip', 0.12, 'hip'],
    ['leftHip', 'leftKnee', 0.10, 'thigh'], ['leftKnee', 'leftFoot', 0.09, 'shin'],
    ['rightHip', 'rightKnee', 0.10, 'thigh'], ['rightKnee', 'rightFoot', 0.09, 'shin']
  ].map(([from, to, radius, kind]) => Object.freeze({ from, to, radius: radius * CHARACTER_SCALE, kind }));
  const BRACES = [['leftShoulder', 'rightShoulder'], ['leftHip', 'rightHip'], ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'], ['leftShoulder', 'rightHip'], ['rightShoulder', 'leftHip'], ['head', 'leftShoulder'], ['head', 'rightShoulder']];
  const BENDS = [['leftShoulder', 'leftHand', 0.18], ['rightShoulder', 'rightHand', 0.18], ['leftHip', 'leftFoot', 0.22], ['rightHip', 'rightFoot', 0.22], ['pelvis', 'head', 0.63]].map(([a, b, min]) => [a, b, min * CHARACTER_SCALE]);
  const CAR_DIMENSIONS = { compact: [46, 27, 1.40], sports: [49, 28, 1.35], van: [55, 32, 1.64] };
  const vectorDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const restDistance = (a, b) => Math.hypot(ANATOMY[a][0] - ANATOMY[b][0], ANATOMY[a][1] - ANATOMY[b][1], ANATOMY[a][2] - ANATOMY[b][2]);

  // Match the aircraft renderer's world yaw followed by local pitch and bank.
  // Keep this independent of Cannon so articulated people use the same pose.
  function aircraftOrientation(entity) {
    const cy=Math.cos(-finite(entity.angle)/2),sy=Math.sin(-finite(entity.angle)/2);
    const cp=Math.cos(finite(entity.pitch)/2),sp=Math.sin(finite(entity.pitch)/2);
    const cr=Math.cos(finite(entity.roll)/2),sr=Math.sin(finite(entity.roll)/2);
    return {x:cy*cp*sr+sy*sp*cr,y:cy*sp*sr+sy*cp*cr,z:cy*sp*cr-sy*cp*sr,w:cy*cp*cr-sy*sp*sr};
  }

  function surfaceHeight(terrain, x, z, reference) {
    if (!terrain) return 0;
    const sample = typeof terrain.surfaceHeight === 'function' ? terrain.surfaceHeight : terrain.heightAt;
    return typeof sample === 'function' ? finite(sample.call(terrain, x * UNIT, z * UNIT, reference)) : 0;
  }

  function surfaceContact(point, radius, terrain) {
    const height = surfaceHeight(terrain, point.x, point.z, point.y);
    const sampler = terrain && (terrain.surfaceNormalAt || terrain.normalAt);
    const sampled = typeof sampler === 'function' ? sampler.call(terrain, point.x * UNIT, point.z * UNIT, point.y) : null;
    let x = finite(sampled && sampled.x), y = finite(sampled && sampled.y, 1), z = finite(sampled && sampled.z);
    const length = Math.hypot(x, y, z);
    if (length < 0.000001 || y <= 0.05) { x = 0; y = 1; z = 0; }
    else { x /= length; y /= length; z /= length; }
    // The shared sampler supplies the rendered triangle's plane. Sphere
    // clearance is measured along that plane's normal, not vertically; this
    // keeps shoulders and bone interiors outside hills and bridge decks.
    const depth = radius - (point.y - height - FLOOR) * y;
    return depth > 0 ? { x, y, z, depth, box: { vx: 0, vy: 0, vz: 0 } } : null;
  }

  function upright(x, z, angle, elevation = 0) {
    const c = Math.cos(angle), s = Math.sin(angle), pose = {};
    for (const name of JOINT_NAMES) {
      const [lx, y, lz] = ANATOMY[name];
      pose[name] = { x: x + lx * c - lz * s, y: y + elevation, z: z + lx * s + lz * c };
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

  // Row-major rotation matrix. The quaternion is the rigid body's complete
  // orientation; the legacy yaw convention sends local +X toward world +Z.
  function boxBasis(orientation, angle = 0) {
    if (orientation && ['x', 'y', 'z', 'w'].every(key => Number.isFinite(orientation[key]))) {
      const length = Math.hypot(orientation.x, orientation.y, orientation.z, orientation.w);
      if (length > 0.000001) {
        const x = orientation.x / length, y = orientation.y / length, z = orientation.z / length, w = orientation.w / length;
        return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
          2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
          2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
      }
    }
    const c = Math.cos(angle), s = Math.sin(angle);
    return [c, 0, -s, 0, 1, 0, s, 0, c];
  }

  function prepareBox(box) {
    box.basis = boxBasis(box.orientation, box.angle);
    const m = box.basis;
    box.extentX = Math.abs(m[0]) * box.hx + Math.abs(m[1]) * box.hy + Math.abs(m[2]) * box.hz;
    box.extentY = Math.abs(m[3]) * box.hx + Math.abs(m[4]) * box.hy + Math.abs(m[5]) * box.hz;
    box.extentZ = Math.abs(m[6]) * box.hx + Math.abs(m[7]) * box.hy + Math.abs(m[8]) * box.hz;
    box.vx = finite(box.vx); box.vy = finite(box.vy); box.vz = finite(box.vz);
    const angular = box.angularVelocity || {};
    box.wx = clamp(finite(angular.x), -14, 14); box.wy = clamp(finite(angular.y), -14, 14); box.wz = clamp(finite(angular.z), -14, 14);
    return box;
  }

  // Sphere against a full 3D oriented box, including flying/tipped roofs.
  // Inverse rotation maps the sphere into the box's local frame; normals are
  // then rotated back into the town frame.
  function sphereBox(point, radius, box) {
    const dx = point.x - box.x, dy = point.y - box.y, dz = point.z - box.z, m = box.basis;
    const lx = dx * m[0] + dy * m[3] + dz * m[6], ly = dx * m[1] + dy * m[4] + dz * m[7], lz = dx * m[2] + dy * m[5] + dz * m[8];
    let qx, qz;
    const cylinder = box.shape === 'cylinder', radial = Math.hypot(lx, lz), cylinderRadius = Math.max(box.hx, box.hz);
    if (cylinder) { const scale = radial > cylinderRadius ? cylinderRadius / radial : 1; qx = lx * scale; qz = lz * scale; }
    else { qx = clamp(lx, -box.hx, box.hx); qz = clamp(lz, -box.hz, box.hz); }
    const qy = clamp(ly, -box.hy, box.hy);
    let nx = lx - qx, ny = ly - qy, nz = lz - qz, length = Math.hypot(nx, ny, nz), depth;
    if (length >= radius) return null;
    if (length > 0.000001) { nx /= length; ny /= length; nz /= length; depth = radius - length; }
    else {
      const sy = box.hy - Math.abs(ly);
      if (cylinder) {
        const side = cylinderRadius - radial;
        if (side <= sy) { nx = radial > 0.000001 ? lx / radial : 1; ny = 0; nz = radial > 0.000001 ? lz / radial : 0; depth = radius + side; }
        else { nx = 0; ny = ly < 0 ? -1 : 1; nz = 0; depth = radius + sy; }
      } else {
        const sx = box.hx - Math.abs(lx), sz = box.hz - Math.abs(lz);
        if (sx <= sy && sx <= sz) { nx = lx < 0 ? -1 : 1; ny = 0; nz = 0; depth = radius + sx; }
        else if (sy <= sz) { nx = 0; ny = ly < 0 ? -1 : 1; nz = 0; depth = radius + sy; }
        else { nx = 0; ny = 0; nz = lz < 0 ? -1 : 1; depth = radius + sz; }
      }
    }
    return { x: nx * m[0] + ny * m[1] + nz * m[2], y: nx * m[3] + ny * m[4] + nz * m[5], z: nx * m[6] + ny * m[7] + nz * m[8], depth };
  }

  function horizontalBox(point, radius, box, landedHeight = point.y, groundHeight = 0) {
    // Grounded recovery only needs clearance from volumes that could reach
    // the standing person. A flying car overhead must not push them sideways.
    // A person who actually landed on an elevated roof must leave its edge
    // before getting up on the ground. People beneath it keep their clearance.
    if ((box.y - box.extentY >= groundHeight + PERSON_HEIGHT + FLOOR && landedHeight < box.y) || box.y + box.extentY <= groundHeight + FLOOR) return null;
    const m = box.basis, forward = Math.hypot(m[0], m[6]);
    if (box.shape === 'cylinder' && Math.abs(m[4]) > 0.9999) {
      const dx = point.x - box.x, dz = point.z - box.z, length = Math.hypot(dx, dz), depth = radius + Math.max(box.hx, box.hz) - length;
      return depth > 0 ? { x: length > 0.000001 ? dx / length : 1, z: length > 0.000001 ? dz / length : 0, depth } : null;
    }
    const c = forward > 0.000001 ? m[0] / forward : 1, s = forward > 0.000001 ? m[6] / forward : 0;
    const hx = Math.abs(c * m[0] + s * m[6]) * box.hx + Math.abs(c * m[1] + s * m[7]) * box.hy + Math.abs(c * m[2] + s * m[8]) * box.hz;
    const hz = Math.abs(-s * m[0] + c * m[6]) * box.hx + Math.abs(-s * m[1] + c * m[7]) * box.hy + Math.abs(-s * m[2] + c * m[8]) * box.hz;
    const dx = point.x - box.x, dz = point.z - box.z;
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    let nx = lx - clamp(lx, -hx, hx), nz = lz - clamp(lz, -hz, hz);
    const length = Math.hypot(nx, nz);
    if (length >= radius) return null;
    let depth;
    if (length > 0.000001) { nx /= length; nz /= length; depth = radius - length; }
    else if (hx - Math.abs(lx) < hz - Math.abs(lz)) { nx = lx < 0 ? -1 : 1; nz = 0; depth = radius + hx - Math.abs(lx); }
    else { nx = 0; nz = lz < 0 ? -1 : 1; depth = radius + hz - Math.abs(lz); }
    return { x: nx * c - nz * s, z: nx * s + nz * c, depth };
  }

  function contactVelocity(j, normal, box, friction = 0.06, bounce = 0.10) {
    const dx = j.x - finite(box.x), dy = j.y - finite(box.y), dz = j.z - finite(box.z);
    const surfaceX = finite(box.vx) + finite(box.wy) * dz - finite(box.wz) * dy;
    const surfaceY = finite(box.vy) + finite(box.wz) * dx - finite(box.wx) * dz;
    const surfaceZ = finite(box.vz) + finite(box.wx) * dy - finite(box.wy) * dx;
    let vx = (j.x - j.px) / STEP - surfaceX, vy = (j.y - j.py) / STEP - surfaceY, vz = (j.z - j.pz) / STEP - surfaceZ;
    const into = vx * normal.x + vy * normal.y + vz * normal.z;
    if (into < 0) { vx -= normal.x * into * (1 + bounce); vy -= normal.y * into * (1 + bounce); vz -= normal.z * into * (1 + bounce); }
    const outward = Math.max(0, vx * normal.x + vy * normal.y + vz * normal.z);
    vx = vx * (1 - friction) + normal.x * outward * friction + surfaceX;
    vy = vy * (1 - friction) + normal.y * outward * friction + surfaceY;
    vz = vz * (1 - friction) + normal.z * outward * friction + surfaceZ;
    j.px = j.x - vx * STEP; j.py = j.y - vy * STEP; j.pz = j.z - vz * STEP;
    limitVelocity(j);
  }

  function projectJoint(j, boxes, size, terrain) {
    const ground = surfaceContact(j, j.radius, terrain);
    if (ground) {
      j.x += ground.x * ground.depth; j.y += ground.y * ground.depth; j.z += ground.z * ground.depth;
      j.px += ground.x * ground.depth; j.py += ground.y * ground.depth; j.pz += ground.z * ground.depth;
      contactVelocity(j, ground, ground.box, 0.12, 0.12);
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

  function projectLimbs(body, boxes, size, terrain) {
    // Particle-only collision lets a shin cut through a corner. Two internal
    // samples on every physical bone distribute contacts to both endpoints.
    for (const part of BODYPARTS) {
      const a = body.joints[part.from], b = body.joints[part.to];
      for (const t of [1 / 3, 2 / 3]) {
        const u = 1 - t, sample = { x: a.x * u + b.x * t, y: a.y * u + b.y * t, z: a.z * u + b.z * t };
        let contacts = [];
        const ground = surfaceContact(sample, part.radius, terrain);
        if (ground) contacts.push(ground);
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
    for (const j of body._points) projectJoint(j, boxes, size, terrain);
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
      const angle = finite(entity.angle), terrain = options.terrain;
      const ground = surfaceHeight(terrain, entity.x / UNIT, entity.y / UNIT, entity.elevation);
      const elevation = clamp(Math.max(finite(entity.elevation, ground), ground) + finite(options.height), -100, 200);
      const pose = upright(entity.x / UNIT, entity.y / UNIT, angle, elevation);
      const joints = {};
      for (const name of JOINT_NAMES) {
        const p = pose[name], anatomy = ANATOMY[name];
        joints[name] = { x: p.x, y: p.y, z: p.z, px: p.x, py: p.y, pz: p.z, radius: anatomy[3], invMass: anatomy[4] };
      }
      const constraints = BODYPARTS.concat(BRACES.map(([from, to]) => ({ from, to }))).map(part => ({ a: part.from, b: part.to, min: restDistance(part.from, part.to), max: restDistance(part.from, part.to) }));
      const bends = BENDS.map(([a, b, min]) => ({ a, b, min, max: restDistance(a, b) + 0.02 * CHARACTER_SCALE }));
      const body = { id: entity.id, owner: entity, angle, age: 0, phase: 'fall', recovery: 0, joints, standingPose: pose, lastImpact: 0, _points: JOINT_NAMES.map(name => joints[name]), _constraints: constraints, _bends: bends, _lastSafeX: entity.x / UNIT, _lastSafeZ: entity.y / UNIT };
      body._excluded = new Set(constraints.concat(bends).map(c => JOINT_NAMES.indexOf(c.a) + ':' + JOINT_NAMES.indexOf(c.b)));
      this.bodies.set(entity.id, body);
      this._kick(body, { ...impulse, y: finite(impulse.y) + finite(entity.verticalVelocity) }, 1);
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
        // Relative impact weighting keeps its feel as the body shrinks. The
        // geometric lever arms and collision shapes use the smaller anatomy.
        const side = anatomy[2] / CHARACTER_SCALE, height = anatomy[1] / CHARACTER_SCALE;
        const twist = side * 0.45, leverage = 0.72 + height * 0.35;
        const vx = ix * leverage + iz * twist, vz = iz * leverage - ix * twist;
        const vy = iy + (name.includes('Hand') ? 0.25 : 0) + horizontal * side * 0.12;
        j.px -= vx * STEP; j.py -= vy * STEP; j.pz -= vz * STEP; limitVelocity(j);
      }
    }

    _colliders(environment) {
      const boxes = [], buildings = environment.buildings || [], seen = new Set();
      buildings.forEach((building, i) => {
        // Building height includes its roof, matching the standing and car
        // worlds. Roof trim and flagpoles remain cosmetic details.
        const height = clamp(finite(building.height, [5.3, 7, 4.5, 6.2, 8.2][i % 5]), 0.4, 40);
        if (![building.x, building.y, building.w, building.h].every(Number.isFinite)) return;
        const elevation = Number.isFinite(building.elevation) ? building.elevation : surfaceHeight(environment.terrain, (building.x + building.w / 2) / UNIT, (building.y + building.h / 2) / UNIT);
        const bottom = Math.min(elevation, finite(building.foundationBottom, elevation)), top = elevation + height;
        boxes.push(prepareBox({ x: (building.x + building.w / 2) / UNIT, z: (building.y + building.h / 2) / UNIT, y: (bottom + top) / 2, hx: building.w / UNIT / 2, hy: (top - bottom) / 2, hz: building.h / UNIT / 2, angle: finite(building.angle), dynamic: false }));
      });
      (environment.staticObjects || []).forEach(object => {
        if (!object || object.destroyed || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return;
        // Trunks, benches, and lamp posts use the same compound solid volumes
        // as the car world. Offsets and half-extents are already in metres.
        const parts = Array.isArray(object.parts) ? object.parts : [{
          offset: [0, finite(object.height, 1) / 2, 0],
          half: [finite(object.width, 10) / UNIT / 2, finite(object.height, 1) / 2, finite(object.depth, 10) / UNIT / 2]
        }];
        const basis = boxBasis(object.orientation, finite(object.angle));
        const elevation = Number.isFinite(object.elevation) ? object.elevation : surfaceHeight(environment.terrain, object.x / UNIT, object.y / UNIT);
        for (const part of parts) {
          if (!part || !Array.isArray(part.offset) || !Array.isArray(part.half) || part.offset.length !== 3 || part.half.length !== 3 || !part.offset.concat(part.half).every(Number.isFinite) || part.half.some(n => n <= 0)) continue;
          const [ox, oy, oz] = part.offset;
          boxes.push(prepareBox({ x: object.x / UNIT + ox * basis[0] + oy * basis[1] + oz * basis[2],
            y: elevation + ox * basis[3] + oy * basis[4] + oz * basis[5],
            z: object.y / UNIT + ox * basis[6] + oy * basis[7] + oz * basis[8],
            hx: part.half[0], hy: part.half[1], hz: part.half[2], shape: part.shape, angle: finite(object.angle), orientation: object.orientation, dynamic: false }));
        }
      });
      for (const car of (environment.cars || []).concat(environment.police || [])) {
        if (!car || !Number.isFinite(car.x) || !Number.isFinite(car.y) || seen.has(car.id || car)) continue;
        seen.add(car.id || car);
        const dimension = CAR_DIMENSIONS[car.kind] || CAR_DIMENSIONS.compact;
        const angle = finite(car.angle), length = clamp(finite(car.colliderLength, finite(car.length, dimension[0])), 10, 120) / UNIT;
        const width = clamp(finite(car.colliderWidth, finite(car.width, dimension[1])), 8, 80) / UNIT;
        const height = clamp(finite(car.colliderHeight, dimension[2]), 0.5, 4), c = Math.cos(angle), s = Math.sin(angle);
        // The rigid body is centred at elevation + height/2. Older yaw-only
        // callers retain their wheel clearance above the ground.
        const bottom = car.orientation ? 0 : 0.13;
        boxes.push(prepareBox({ x: car.x / UNIT, z: car.y / UNIT, y: finite(car.elevation) + (height + bottom) / 2, hx: length / 2, hy: (height - bottom) / 2, hz: width / 2, angle, orientation: car.orientation,
          vx: clamp(finite(car.vx, finite(car.speed) * c) / UNIT, -20, 20), vy: clamp(finite(car.verticalVelocity), -20, 20), vz: clamp(finite(car.vy, finite(car.speed) * s) / UNIT, -20, 20), angularVelocity: car.angularVelocity, dynamic: true }));
      }
      const aircraft=environment.aircraft||[];
      const Aircraft=aircraft.length&&(root.MayhemAircraft||(typeof require==='function'?require('./aircraft.js'):null));
      for(const craft of aircraft) {
        if(!craft||craft.visible===false||craft.active===false||!Number.isFinite(craft.x)||!Number.isFinite(craft.y)||seen.has(craft.id||craft))continue;
        const model=Aircraft?.AIRCRAFT_TYPES[craft.aircraftType];if(!model)continue;
        seen.add(craft.id||craft);
        const length=Math.max(.1,finite(craft.colliderLength,model.length)/UNIT),width=Math.max(.1,finite(craft.colliderWidth,model.width)/UNIT);
        const height=Math.max(.1,finite(craft.colliderHeight,model.height)),orientation=aircraftOrientation(craft),basis=boxBasis(orientation,finite(craft.angle));
        // Airframe geometry rotates around the ground anchor, whereas chassis
        // geometry rotates about its centre. Rotate the centre offset as well.
        boxes.push(prepareBox({x:craft.x/UNIT+basis[1]*height/2,y:finite(craft.elevation)+basis[4]*height/2,z:craft.y/UNIT+basis[7]*height/2,
          hx:length/2,hy:height/2,hz:width/2,angle:finite(craft.angle),orientation,dynamic:true,
          vx:clamp(finite(craft.vx)/UNIT,-20,20),vy:clamp(finite(craft.verticalVelocity,finite(craft.vz)),-20,20),vz:clamp(finite(craft.vy)/UNIT,-20,20),angularVelocity:craft.angularVelocity}));
      }
      return boxes;
    }

    _nearby(body, boxes) {
      const p = body.joints.pelvis;
      return boxes.filter(box => Math.abs(p.x - box.x) <= box.extentX + 3 && Math.abs(p.z - box.z) <= box.extentZ + 3 && Math.abs(p.y - box.y) <= box.extentY + 3);
    }

    _recovery(body, boxes, size, terrain) {
      const pelvis = body.joints.pelvis;
      // Choose a standing centre near the landed pelvis, with shoulder-width
      // clearance. This also lets a character stand beside a stopped car.
      const radius = Math.max(0.43 * CHARACTER_SCALE, (body.owner.id === 'player' ? PLAYER_RADIUS : NPC_RADIUS) / UNIT);
      const margin = radius + 0.02 * CHARACTER_SCALE;
      const centre = { x: clamp(pelvis.x, margin, size - margin), y: ANATOMY.pelvis[1], z: clamp(pelvis.z, margin, size - margin) };
      for (let pass = 0; pass < 3; pass++) for (const box of boxes) {
        const ground = surfaceHeight(terrain, centre.x, centre.z, pelvis.y);
        centre.y = ground + ANATOMY.pelvis[1];
        const hit = horizontalBox(centre, radius, box, pelvis.y, ground);
        if (!hit) continue;
        centre.x += hit.x * hit.depth; centre.z += hit.z * hit.depth;
      }
      centre.x = clamp(centre.x, margin, size - margin); centre.z = clamp(centre.z, margin, size - margin);
      body.standingPose = upright(centre.x, centre.z, body.angle, surfaceHeight(terrain, centre.x, centre.z, pelvis.y));
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
        if (vectorDistance(a.joints.pelvis, b.joints.pelvis) > 2.1 * CHARACTER_SCALE) continue;
        for (const ja of a._points) for (const jb of b._points) {
          const radius = ja.radius + jb.radius;
          if (vectorDistance(ja, jb) < radius) distanceConstraint(ja, jb, radius, Infinity, 0.6);
        }
      }
    }

    _simulate(boxes, size, terrain) {
      const bodies = Array.from(this.bodies.values());
      for (const body of bodies) {
        body.age += STEP; body.phase = body.age + 1e-8 < 3 ? 'fall' : 'recover';
        body.recovery = body.phase === 'recover' ? clamp((body.age - 3) / 0.8, 0, 1) : 0;
        body._near = this._nearby(body, boxes);
        for (const j of body._points) {
          if (![j.x, j.y, j.z, j.px, j.py, j.pz].every(Number.isFinite)) {
            const p = upright(body._lastSafeX, body._lastSafeZ, body.angle, surfaceHeight(terrain, body._lastSafeX, body._lastSafeZ))[JOINT_NAMES[body._points.indexOf(j)]];
            j.x = j.px = p.x; j.y = j.py = p.y; j.z = j.pz = p.z;
          }
          limitVelocity(j);
          const vx = (j.x - j.px) * 0.997, vy = (j.y - j.py) * 0.997, vz = (j.z - j.pz) * 0.997;
          j.px = j.x; j.py = j.y; j.pz = j.z;
          j.x += vx; j.y += vy - 9.81 * STEP * STEP; j.z += vz;
        }
        if (body.phase === 'recover') this._recovery(body, body._near, size, terrain);
      }
      for (let iteration = 0; iteration < 6; iteration++) {
        for (const body of bodies) {
          for (const c of body._constraints) distanceConstraint(body.joints[c.a], body.joints[c.b], c.min, c.max);
          for (const c of body._bends) distanceConstraint(body.joints[c.a], body.joints[c.b], c.min, c.max, 0.7);
          this._selfContacts(body);
          if (iteration === 2 || iteration === 5) projectLimbs(body, body._near, size, terrain);
          else for (const j of body._points) projectJoint(j, body._near, size, terrain);
        }
        if (iteration === 2) this._bodyContacts(bodies);
      }
      this._tick++;
      for (const body of bodies) {
        const p = body.joints.pelvis;
        body._lastSafeX = p.x; body._lastSafeZ = p.z;
        body.owner.x = p.x * UNIT; body.owner.y = p.z * UNIT;
        body.owner.elevation = Math.max(surfaceHeight(terrain, p.x, p.z, p.y), p.y - ANATOMY.pelvis[1]);
        body.owner.verticalVelocity = (p.y - p.py) / STEP;
        for (const j of body._points) limitVelocity(j);
      }
    }

    step(dt, environment = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return [];
      this._accumulator += Math.min(dt, 0.25);
      // Preserve the fixed-step phase without rebuilding the town's collider
      // boxes when there are no articulated bodies to collide with them.
      if (!this.bodies.size) {
        while (this._accumulator + 1e-10 >= STEP) { this._accumulator -= STEP; this._tick++; }
        return [];
      }
      const boxes = this._colliders(environment), size = clamp(finite(environment.size, 2160) / UNIT, 4, 1000), finished = [];
      while (this._accumulator + 1e-10 >= STEP) {
        this._simulate(boxes, size, environment.terrain); this._accumulator -= STEP;
        for (const [id, body] of this.bodies) {
          if (body.age + 1e-8 >= 3.8) { this.bodies.delete(id); body.owner.elevation = surfaceHeight(environment.terrain, body.owner.x / UNIT, body.owner.y / UNIT, body.owner.elevation); body.owner.verticalVelocity = 0; finished.push(body); }
        }
      }
      return finished;
    }
  }

  const api = { RagdollWorld, BODYPARTS, JOINT_NAMES, STEP, FLOOR, CHARACTER_SCALE, PERSON_HEIGHT, MUZZLE_HEIGHT, PLAYER_RADIUS, NPC_RADIUS, aircraftOrientation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MayhemPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
