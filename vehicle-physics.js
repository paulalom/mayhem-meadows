(function (root) {
  'use strict';
  const C = root.CANNON || (typeof require === 'function' ? require('./vendor/cannon.cjs') : null);
  const SCALE = 20;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const height = entity => entity.kind === 'van' ? 1.7 : 1.3;
  const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;

  function personContact(person, vehicle, radius, type) {
    const q = vehicle.orientation ? new C.Quaternion(vehicle.orientation.x, vehicle.orientation.y, vehicle.orientation.z, vehicle.orientation.w) : new C.Quaternion().setFromEuler(0, -finite(vehicle.angle), 0);
    const inverse = q.conjugate(), h = height(vehicle), r = radius / SCALE;
    const center = new C.Vec3(vehicle.x / SCALE, finite(vehicle.elevation) + h / 2, vehicle.y / SCALE);
    const half = [type.length / 40, h / 2, type.width / 40];
    let best = null;
    for (const vertical of [r, 0.85, 1.7 - r]) {
      const world = new C.Vec3(person.x / SCALE, finite(person.elevation) + vertical, person.y / SCALE);
      const local = inverse.vmult(world.vsub(center));
      const values = [local.x, local.y, local.z], nearest = values.map((v, i) => clamp(v, -half[i], half[i]));
      let delta = values.map((v, i) => v - nearest[i]), d = Math.hypot(...delta), depth = r - d;
      if (depth <= 0) continue;
      if (d < 0.000001) {
        const gaps = values.map((v, i) => half[i] - Math.abs(v)), axis = gaps.indexOf(Math.min(...gaps));
        delta = [0,0,0]; delta[axis] = values[axis] < 0 ? -1 : 1; d = 1; depth = r + gaps[axis];
      }
      const normal = q.vmult(new C.Vec3(...delta.map(v => v / d))), horizontal = Math.hypot(normal.x, normal.z);
      // Roof/underbody contacts are resolved by the height sweep, not a phantom
      // flat footprint. Tipped roofs still present their actual side normals.
      const hit = horizontal < 0.15 ? { vertical: true, up: normal.y, nx: 0, ny: 0, depth: depth * SCALE } :
        { nx: normal.x / horizontal, ny: normal.z / horizontal, depth: depth / horizontal * SCALE };
      if (!best || hit.depth > best.depth) best = hit;
    }
    return best;
  }

  // All three dimensions are simulated. The game retains its original x/y map
  // coordinates; Cannon and the renderer share x/up/z coordinates in metres.
  class VehicleWorld {
    constructor(game, types) {
      this.game = game; this.types = types; this.bodies = new Map(); this.impacts = []; this._pendingLaunches = [];
      this.world = new C.World({ gravity: new C.Vec3(0, -18, 0), allowSleep: true });
      this.world.broadphase = new C.SAPBroadphase(this.world);
      this.world.solver.iterations = 12;
      this.carMaterial = new C.Material('car');
      this.wallMaterial = new C.Material('fixed');
      this.floorMaterial = new C.Material('road');
      this.world.addContactMaterial(new C.ContactMaterial(this.carMaterial, this.carMaterial, { friction: 0.08, restitution: 0.48 }));
      this.world.addContactMaterial(new C.ContactMaterial(this.carMaterial, this.wallMaterial, { friction: 0.06, restitution: 0.42 }));
      // Tyre grip is applied by the arcade controller. Chassis friction would
      // pin the flat body to the road before its driving force can accelerate.
      this.world.addContactMaterial(new C.ContactMaterial(this.carMaterial, this.floorMaterial, { friction: 0, restitution: 0.08 }));
      this.floor = new C.Body({ mass: 0, material: this.floorMaterial });
      this.floor.addShape(new C.Plane()); this.floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      this.world.addBody(this.floor);
      this._townBodies = [];
      for (const building of game.buildings) this._fixed('building', building.x + building.w / 2, building.y + building.h / 2, [{ half: [building.w / 40, building.height / 2, building.h / 40], offset: [0, building.height / 2, 0] }]);
      for (const object of game.staticObjects) this._fixed(object.kind, object.x, object.y, object.parts, object);
      const size = game.constructor.SIZE || 2160, wallHeight = 6;
      this._fixed('boundary', -10, size / 2, [{ half: [0.5, wallHeight / 2, size / 40], offset: [0, wallHeight / 2, 0] }]);
      this._fixed('boundary', size + 10, size / 2, [{ half: [0.5, wallHeight / 2, size / 40], offset: [0, wallHeight / 2, 0] }]);
      this._fixed('boundary', size / 2, -10, [{ half: [size / 40, wallHeight / 2, 0.5], offset: [0, wallHeight / 2, 0] }]);
      this._fixed('boundary', size / 2, size + 10, [{ half: [size / 40, wallHeight / 2, 0.5], offset: [0, wallHeight / 2, 0] }]);
      this._launchAt = new Map();
      this._buildings = game.buildings; this._objects = game.staticObjects;
      this.sync();
    }

    _fixed(kind, x, z, parts, source) {
      const body = new C.Body({ mass: 0, material: this.wallMaterial, position: new C.Vec3(x / SCALE, 0, z / SCALE) });
      body.kind = kind; body.source = source;
      if (source && source.angle) body.quaternion.setFromEuler(0, -source.angle, 0);
      for (const part of parts) {
        const shape = part.shape === 'cylinder' ? new C.Cylinder(part.half[0], part.half[0], part.half[1] * 2, 12) : new C.Box(new C.Vec3(...part.half));
        body.addShape(shape, new C.Vec3(...part.offset));
      }
      this.world.addBody(body); return body;
    }

    _snapshot(entity) {
      return { x: entity.x, y: entity.y, angle: entity.angle, elevation: entity.elevation, speed: entity.speed, vx: entity.vx, vy: entity.vy,
        verticalVelocity: entity.verticalVelocity, orientation: JSON.stringify(entity.orientation) };
    }

    _body(entity) {
      let entry = this.bodies.get(entity.id);
      if (entry) return entry;
      const type = this.types[entity.kind] || this.types.compact, h = height(entity);
      const body = new C.Body({ mass: 700 * type.mass, material: this.carMaterial, linearDamping: 0.015, angularDamping: 0.28,
        sleepSpeedLimit: 0.08, sleepTimeLimit: 1.5 });
      body.addShape(new C.Box(new C.Vec3(type.length / 40, h / 2, type.width / 40)));
      body.position.set(entity.x / SCALE, finite(entity.elevation) + h / 2 + 0.004, entity.y / SCALE);
      if (entity.orientation) body.quaternion.set(entity.orientation.x, entity.orientation.y, entity.orientation.z, entity.orientation.w);
      else body.quaternion.setFromEuler(0, -finite(entity.angle), 0);
      body.velocity.set(finite(entity.vx, Math.cos(entity.angle) * entity.speed) / SCALE, finite(entity.verticalVelocity), finite(entity.vy, Math.sin(entity.angle) * entity.speed) / SCALE);
      if (entity.speed && !entity.vx && !entity.vy) body.velocity.set(Math.cos(entity.angle) * entity.speed / SCALE, finite(entity.verticalVelocity), Math.sin(entity.angle) * entity.speed / SCALE);
      body.entity = entity;
      entity.colliderHeight = h; entity.collisionHeight = h;
      body.addEventListener('collide', event => this._collision(body, event.body, event.contact));
      this.world.addBody(body);
      entry = { body, height: h, snapshot: this._snapshot(entity), control: null };
      this.bodies.set(entity.id, entry); return entry;
    }

    sync() {
      if (this._buildings !== this.game.buildings || this._objects !== this.game.staticObjects) {
        for (const body of this.world.bodies.slice()) if (body.mass === 0 && body !== this.floor && body.kind !== 'boundary') this.world.removeBody(body);
        for (const b of this.game.buildings) this._fixed('building', b.x + b.w / 2, b.y + b.h / 2, [{ half: [b.w / 40, b.height / 2, b.h / 40], offset: [0,b.height / 2,0] }]);
        for (const object of this.game.staticObjects) this._fixed(object.kind, object.x, object.y, object.parts, object);
        this._buildings = this.game.buildings; this._objects = this.game.staticObjects;
      }
      const alive = new Set();
      for (const entity of this.game.cars.concat(this.game.police)) {
        alive.add(entity.id); const entry = this._body(entity), body = entry.body, old = entry.snapshot;
        const positionChanged = entity.x !== old.x || entity.y !== old.y || entity.elevation !== old.elevation;
        const angleChanged = entity.angle !== old.angle, orientationChanged = JSON.stringify(entity.orientation) !== old.orientation;
        if (positionChanged) { body.position.set(entity.x / SCALE, finite(entity.elevation) + entry.height / 2 + 0.004, entity.y / SCALE); body.wakeUp(); body.aabbNeedsUpdate = true; }
        if (orientationChanged && entity.orientation) body.quaternion.set(entity.orientation.x, entity.orientation.y, entity.orientation.z, entity.orientation.w);
        else if (angleChanged) body.quaternion.setFromEuler(0, -entity.angle, 0);
        if (entity.vx !== old.vx || entity.vy !== old.vy) { body.velocity.x = finite(entity.vx) / SCALE; body.velocity.z = finite(entity.vy) / SCALE; body.wakeUp(); }
        else if (entity.speed !== old.speed) { body.velocity.x = Math.cos(entity.angle) * entity.speed / SCALE; body.velocity.z = Math.sin(entity.angle) * entity.speed / SCALE; body.wakeUp(); }
        if (entity.verticalVelocity !== old.verticalVelocity) { body.velocity.y = finite(entity.verticalVelocity); body.wakeUp(); }
        entry.control = null;
      }
      for (const [id, entry] of this.bodies) if (!alive.has(id)) { this.world.removeBody(entry.body); this.bodies.delete(id); }
    }

    control(entity, command) { this._body(entity).control = command; }
    get(id) { return this.bodies.get(id)?.body || null; }

    _supported(body) {
      return this.world.contacts.some(contact => contact.bi === body && contact.ni.y < -0.65 || contact.bj === body && contact.ni.y > 0.65);
    }

    _drive(entry, dt) {
      const body = entry.body, entity = body.entity, command = entry.control, type = this.types[entity.kind] || this.types.compact;
      const up = body.quaternion.vmult(new C.Vec3(0, 1, 0)), forward = body.quaternion.vmult(new C.Vec3(1, 0, 0));
      const grounded = (body.position.y - entry.height / 2 < 0.15 || this._supported(body)) && up.y > 0.55;
      if (!grounded) return;
      if (!command) { body.force.x -= body.velocity.x * body.mass * 0.5; body.force.z -= body.velocity.z * body.mass * 0.5; return; }
      const heading = Math.atan2(forward.z, forward.x), speed = body.velocity.x * Math.cos(heading) + body.velocity.z * Math.sin(heading);
      let acceleration = 0, steer = command.steer || 0;
      if (command.targetSpeed !== undefined) {
        acceleration = clamp((command.targetSpeed / SCALE - speed) * 4, -12, type.acceleration / SCALE);
        const error = Math.atan2(Math.sin(command.heading - heading), Math.cos(command.heading - heading));
        steer = clamp(error * 2, -1, 1);
      } else {
        if (command.up) acceleration += type.acceleration / SCALE * (command.boost ? 1.3 : 1);
        if (command.down) acceleration -= speed > 0.75 ? 35 : 13;
        if (!command.up && !command.down) acceleration -= speed * 1.1;
      }
      const max = (command.maxSpeed || type.maxSpeed) / SCALE;
      if (speed > max) acceleration = Math.min(acceleration, (max - speed) * 8);
      if (speed < -5.5) acceleration = Math.max(acceleration, (-5.5 - speed) * 8);
      if (command.brake) acceleration -= speed * 3.8;
      const lateral = -body.velocity.x * Math.sin(heading) + body.velocity.z * Math.cos(heading);
      const grip = command.brake ? 2.4 : type.grip;
      body.force.x += body.mass * (Math.cos(heading) * acceleration + Math.sin(heading) * lateral * grip);
      body.force.z += body.mass * (Math.sin(heading) * acceleration - Math.cos(heading) * lateral * grip);
      const yawRate = steer * type.handling * clamp(Math.abs(speed) / 7.5, 0.2, 1) * (command.brake ? 1.35 : 1) * Math.sign(speed);
      // Steering controls only yaw. Collision roll/pitch are never overwritten.
      body.angularVelocity.y += (-yawRate - body.angularVelocity.y) * Math.min(1, 8 * dt);
      body.wakeUp();
    }

    _collision(body, other, contact) {
      if (other === this.floor) return;
      if (Math.abs(contact.ni.y) > 0.65) { contact.restitution = 0.08; return; }
      const closing = Math.abs(contact.getImpactVelocityAlongNormal());
      if (closing < 1.5) return;
      this.impacts.push({ entity: body.entity, other: other.entity || null, speed: closing * SCALE, vehicle: Boolean(other.entity) });
      const pair = other.entity ? [body.entity.id, other.entity.id].sort().join(':') : body.entity.id + ':' + other.id;
      if (closing < (other.entity ? 6.5 : 9) || this.world.time - (this._launchAt.get(pair) ?? -10) < 0.8) return;
      this._launchAt.set(pair, this.world.time);
      // A bounded cartoon kick supplements the contact impulse at high speed.
      // It acts on the real body, so roofs, cars and gravity still govern flight.
      const lift = clamp((closing - 5) * (other.entity ? 0.95 : 0.5), 0.8, other.entity ? 10.5 : 6.5);
      this._pendingLaunches.push({ body, other, lift });
    }

    step(dt) {
      this.impacts = [];
      // Two solver steps improve thin-post contacts and fast bumper impacts.
      for (let substep = 0; substep < 2; substep++) {
        for (const entry of this.bodies.values()) this._drive(entry, dt / 2);
        this.world.step(dt / 2);
        // Apply the extra lift after contact solving so the road constraint
        // cannot erase it during the same instant the bumper hits the wall.
        for (const { body, other, lift } of this._pendingLaunches.splice(0)) {
          body.applyImpulse(new C.Vec3(0, lift * body.mass, 0), new C.Vec3(0, 0, body.entity.id.length % 2 ? 0.24 : -0.24));
          if (other.entity) other.applyImpulse(new C.Vec3(0, lift * other.mass * 0.8, 0), new C.Vec3(0.15, 0, 0));
          body.wakeUp(); if (other.entity) other.wakeUp();
        }
      }
      for (const entry of this.bodies.values()) {
        const body = entry.body, entity = body.entity;
        body.velocity.x = clamp(body.velocity.x, -32, 32); body.velocity.z = clamp(body.velocity.z, -32, 32); body.velocity.y = clamp(body.velocity.y, -22, 12);
        entity.x = body.position.x * SCALE; entity.y = body.position.z * SCALE;
        entity.elevation = body.position.y - entry.height / 2;
        entity.orientation = { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w };
        entity.angularVelocity = { x: body.angularVelocity.x, y: body.angularVelocity.y, z: body.angularVelocity.z };
        const forward = body.quaternion.vmult(new C.Vec3(1, 0, 0)), up = body.quaternion.vmult(new C.Vec3(0, 1, 0));
        entity.angle = Math.atan2(forward.z, forward.x);
        entity.vx = body.velocity.x * SCALE; entity.vy = body.velocity.z * SCALE;
        entity.speed = entity.vx * Math.cos(entity.angle) + entity.vy * Math.sin(entity.angle);
        entity.verticalVelocity = body.velocity.y; entity.upright = up.y > 0.6;
        entity.grounded = (entity.elevation < 0.12 || this._supported(body)) && entity.upright;
        entity.collisionHeight = entry.height; entry.snapshot = this._snapshot(entity);
      }
      return this.impacts;
    }

    reset(entity) {
      const entry = this._body(entity), body = entry.body;
      body.position.set(entity.x / SCALE, entry.height / 2 + 0.006, entity.y / SCALE);
      body.quaternion.setFromEuler(0, -entity.angle, 0); body.velocity.setZero(); body.angularVelocity.setZero(); body.force.setZero(); body.torque.setZero();
      entity.elevation = 0; entity.verticalVelocity = 0; entity.vx = entity.vy = entity.speed = 0; entity.grounded = entity.upright = true;
      entity.orientation = { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w };
      entity.angularVelocity = { x: 0, y: 0, z: 0 }; entry.snapshot = this._snapshot(entity); body.wakeUp(); body.aabbNeedsUpdate = true;
    }

    support(x, z, top = 100) {
      const ray = this.world.raycastClosest(new C.Vec3(x / SCALE, top, z / SCALE), new C.Vec3(x / SCALE, -0.1, z / SCALE), { skipBackfaces: true }, this._ray || (this._ray = new C.RaycastResult()));
      return ray ? Math.max(0, this._ray.hitPointWorld.y) : 0;
    }

    hitsSegment(from, to) {
      const result = new C.RaycastResult();
      return this.world.raycastClosest(new C.Vec3(from.x / SCALE, from.height, from.y / SCALE), new C.Vec3(to.x / SCALE, to.height, to.y / SCALE), { skipBackfaces: false }, result);
    }

    ceiling(x, z, fromHeight, toHeight) {
      let ceiling = Infinity;
      for (const [dx,dz] of [[0,0],[0.4,0],[-0.4,0],[0,0.4],[0,-0.4]]) {
        const result = new C.RaycastResult();
        if (this.world.raycastClosest(new C.Vec3(x / SCALE + dx, fromHeight, z / SCALE + dz), new C.Vec3(x / SCALE + dx, toHeight, z / SCALE + dz), { skipBackfaces: false }, result)) ceiling = Math.min(ceiling, result.hitPointWorld.y);
      }
      return ceiling;
    }
  }
  root.MayhemVehiclePhysics = { VehicleWorld, height, personContact, SCALE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MayhemVehiclePhysics;
})(globalThis);
