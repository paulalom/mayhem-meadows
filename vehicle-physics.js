(function (root) {
  'use strict';
  const C = root.CANNON || (typeof require === 'function' ? require('./vendor/cannon.cjs') : null);
  const Physics = root.MayhemPhysics || (typeof require === 'function' ? require('./physics.js') : null);
  const VehicleStats = root.MayhemVehicleStats || (typeof require === 'function' ? require('./vehicle-stats.js') : null);
  const SCALE = 20;
  const ROAD_VEHICLE_GROUP = 2;
  const NO_ROADS = Object.freeze([]);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
  function aircraftModel(entity) {
    if(entity?.kind!=='aircraft')return null;
    const Aircraft=root.MayhemAircraft||(typeof require==='function'?require('./aircraft.js'):null);
    return Aircraft?.AIRCRAFT_TYPES[entity.aircraftType]||null;
  }
  const height = entity => aircraftModel(entity)?.height ?? (entity.kind === 'van' ? 1.7 : 1.3);
  function quaternion(entity) {
    const pose=aircraftModel(entity)?Physics.aircraftOrientation(entity):entity.orientation;
    return pose?new C.Quaternion(pose.x,pose.y,pose.z,pose.w):new C.Quaternion().setFromEuler(0,-finite(entity.angle),0);
  }

  function personContact(person, vehicle, radius, type) {
    const q = quaternion(vehicle);
    const inverse = q.conjugate(), h = height(vehicle), r = radius / SCALE;
    const offset=aircraftModel(vehicle)?q.vmult(new C.Vec3(0,h/2,0)):new C.Vec3(0,h/2,0);
    const center = new C.Vec3(vehicle.x / SCALE+offset.x, finite(vehicle.elevation)+offset.y, vehicle.y / SCALE+offset.z);
    const half = [type.length / 40, h / 2, type.width / 40];
    let best = null;
    for (const vertical of [r, Physics.PERSON_HEIGHT / 2, Physics.PERSON_HEIGHT - r]) {
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
      this.game = game; this.types = types; this.bodies = new Map(); this.aircraftBodies = new Map(); this.impacts = []; this._pendingLaunches = [];
      this.world = new C.World({ gravity: new C.Vec3(0, -18, 0), allowSleep: true });
      this.world.broadphase = new C.SAPBroadphase(this.world);
      // Long bridge segments and map boundaries have very loose spheres.
      // Their exact world AABBs reject distant pairs before narrowphase work.
      this.world.broadphase.useBoundingBoxes = true;
      // Almost all town bodies are fixed scenery. Store only actual contacts
      // instead of clearing a dense body-pair matrix twice per simulation tick.
      this.world.collisionMatrix = new C.ObjectCollisionMatrix();
      this.world.collisionMatrixPrevious = new C.ObjectCollisionMatrix();
      this.world.solver.iterations = 12;
      this.carMaterial = new C.Material('car');
      this.wallMaterial = new C.Material('fixed');
      this.floorMaterial = new C.Material('road');
      this.world.addContactMaterial(new C.ContactMaterial(this.carMaterial, this.carMaterial, { friction: 0.08, restitution: 0.48 }));
      this.world.addContactMaterial(new C.ContactMaterial(this.carMaterial, this.wallMaterial, { friction: 0.06, restitution: 0.42 }));
      // Tyre grip is applied by the arcade controller. Chassis friction would
      // pin the flat body to the road before its driving force can accelerate.
      this.world.addContactMaterial(new C.ContactMaterial(this.carMaterial, this.floorMaterial, { friction: 0, restitution: 0.08 }));
      this._makeFloor();
      this._makeBridges();
      this._townBodies = [];
      for (const building of game.buildings) this._building(building);
      for (const object of game.staticObjects) if (!object.destroyed) this._fixed(object.kind, object.x, object.y, object.parts, object);
      this._boundaries();
      this._launchAt = new Map();
      this._buildings = game.buildings; this._objects = game.staticObjects;
      this._environmentVersion = game._environmentVersion;
      this.sync();
    }

    _terrain() { return this.game.terrain || this.game.world?.terrain || null; }

    groundHeight(x, z) {
      const terrain = this._terrain();
      return terrain ? finite((terrain.surfaceHeight || terrain.heightAt).call(terrain, x, z)) : 0;
    }

    _surfaceNormal(x, z) {
      const terrain = this._terrain(), sample = terrain && (terrain.surfaceNormalAt || terrain.normalAt);
      const value = sample ? sample.call(terrain, x, z) : null;
      const normal = new C.Vec3(finite(value?.x), finite(value?.y, 1), finite(value?.z));
      if (normal.lengthSquared() < 0.01 || normal.y < 0.2) normal.set(0, 1, 0);
      normal.normalize(); return normal;
    }

    _surfaceQuaternion(x, z, angle) {
      const normal = this._surfaceNormal(x, z);
      return new C.Quaternion().setFromVectors(new C.Vec3(0, 1, 0), normal)
        .mult(new C.Quaternion().setFromEuler(0, -finite(angle), 0));
    }

    _groundPose(x, z, angle, half) {
      const yaw = new C.Quaternion().setFromEuler(0, -finite(angle), 0);
      const cornerHeight = (localX, localZ) => {
        const offset = yaw.vmult(new C.Vec3(localX, 0, localZ));
        return this.groundHeight(x + offset.x * SCALE, z + offset.z * SCALE);
      };
      const a = cornerHeight(-half.x, -half.z), b = cornerHeight(half.x, -half.z);
      const c = cornerHeight(-half.x, half.z), d = cornerHeight(half.x, half.z);
      // A chassis spans several terrain triangles. Fit its resting plane to
      // the footprint rather than tilting a long van to one centre triangle.
      const normal = yaw.vmult(new C.Vec3(-(b + d - a - c) / (4 * half.x), 1, -(c + d - a - b) / (4 * half.z)));
      normal.normalize();
      const quaternion = new C.Quaternion().setFromVectors(new C.Vec3(0, 1, 0), normal).mult(yaw);
      const restingHeight = this._footprintHeight(x, z, quaternion, half);
      return { quaternion, centreHeight: restingHeight + 0.006, elevation: restingHeight - half.y };
    }

    _footprintHeight(x, z, quaternion, half) {
      const normal = quaternion.vmult(new C.Vec3(0, 1, 0));
      if (normal.y < 0.2) return Infinity;
      let centreHeight = -Infinity;
      const sample = (dx, dz) => {
        const offsetY = (-half.y - normal.x * dx - normal.z * dz) / normal.y;
        centreHeight = Math.max(centreHeight, this.groundHeight(x + dx * SCALE, z + dz * SCALE) - offsetY);
      };
      for (const localX of [-half.x, 0, half.x]) for (const localZ of [-half.z, 0, half.z]) {
        const offset = quaternion.vmult(new C.Vec3(localX, -half.y, localZ));
        sample(offset.x, offset.z);
      }
      const step = finite(this._terrain()?.step) / SCALE;
      if (step > 0) {
        const corners = [[-half.x,-half.z],[half.x,-half.z],[half.x,half.z],[-half.x,half.z]]
          .map(([localX,localZ]) => quaternion.vmult(new C.Vec3(localX,-half.y,localZ)));
        const worldX = x / SCALE, worldZ = z / SCALE;
        const minX = Math.min(...corners.map(p=>p.x)) + worldX, maxX = Math.max(...corners.map(p=>p.x)) + worldX;
        const minZ = Math.min(...corners.map(p=>p.z)) + worldZ, maxZ = Math.max(...corners.map(p=>p.z)) + worldZ;
        const inside = (dx,dz) => corners.every((a,i) => {
          const b = corners[(i+1)%4]; return (b.x-a.x)*(dz-a.z)-(b.z-a.z)*(dx-a.x) >= -1e-9;
        });
        // Peaks can lie between wheel samples. Include the terrain vertices
        // and every footprint/grid edge crossing, including cell diagonals.
        for (let ix=Math.ceil(minX/step);ix<=Math.floor(maxX/step);ix++) for (let iz=Math.ceil(minZ/step);iz<=Math.floor(maxZ/step);iz++) {
          const dx=ix*step-worldX,dz=iz*step-worldZ; if(inside(dx,dz)) sample(dx,dz);
        }
        for (let i=0;i<4;i++) {
          const a=corners[i],b=corners[(i+1)%4];
          for (const axis of ['x','z','diagonal']) {
            const av=axis==='diagonal'?a.x+a.z:a[axis], bv=axis==='diagonal'?b.x+b.z:b[axis];
            const origin=axis==='diagonal'?worldX+worldZ:axis==='x'?worldX:worldZ;
            if(Math.abs(bv-av)<1e-9) continue;
            for(let k=Math.ceil((Math.min(av,bv)+origin)/step);k<=Math.floor((Math.max(av,bv)+origin)/step);k++) {
              const t=(k*step-origin-av)/(bv-av); sample(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t);
            }
          }
        }
      }
      return centreHeight;
    }

    _makeFloor() {
      if (this.floor) this.world.removeBody(this.floor);
      const terrain = this._terrain();
      this.floor = new C.Body({ mass: 0, material: this.floorMaterial });
      if (terrain && terrain.count > 1 && terrain.step > 0 && terrain.heights?.length === terrain.count * terrain.count) {
        const data = Array.from({ length: terrain.count }, (_, row) => Array.from(terrain.heights.subarray
          ? terrain.heights.subarray(row * terrain.count, (row + 1) * terrain.count)
          : terrain.heights.slice(row * terrain.count, (row + 1) * terrain.count)));
        this.heightfield = new C.Heightfield(data, { elementSize: terrain.step / SCALE });
        this.floor.addShape(this.heightfield);
        // Cannon's grid lives in local X/Y with height along local Z. This
        // cyclic rotation maps row Y to world Z, column X to world X, and
        // height to world up, preserving the shared anti-diagonal triangles.
        this.floor.quaternion.set(-0.5, -0.5, -0.5, 0.5);
        this.floor.kind = 'terrain';
      } else {
        this.heightfield = null;
        this.floor.addShape(new C.Plane()); this.floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        this.floor.kind = 'floor';
      }
      this.world.addBody(this.floor); this._terrainModel = terrain;
    }

    _makeBridges() {
      for (const body of this.bridgeBodies || []) this.world.removeBody(body);
      this.bridgeBodies = [];
      const roads = this.game.roads || this.game.world?.roads || NO_ROADS;
      if (this._terrain()) for (const road of roads) if (road.bridge || road.railOverpasses?.length) {
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1], b = road.points[i];
          const dx = (b.x - a.x) / SCALE, dz = (b.y - a.y) / SCALE;
          const ay = finite(a.elevation, this.groundHeight(a.x, a.y)), by = finite(b.elevation, this.groundHeight(b.x, b.y));
          const horizontal = Math.hypot(dx, dz);
          if (horizontal < 0.001) continue;
          const dy = by - ay, length = Math.hypot(horizontal, dy), heading = Math.atan2(dz, dx);
          const quaternion = new C.Quaternion().setFromEuler(0, -heading, 0)
            .mult(new C.Quaternion().setFromEuler(0, 0, Math.atan2(dy, horizontal)));
          const normal = quaternion.vmult(new C.Vec3(0, 1, 0)), halfHeight = 0.16;
          const body = new C.Body({ mass: 0, material: this.floorMaterial,
            position: new C.Vec3((a.x + b.x) / SCALE / 2 - normal.x * halfHeight,
              (ay + by) / 2 - normal.y * halfHeight, (a.y + b.y) / SCALE / 2 - normal.z * halfHeight) });
          body.addShape(new C.Box(new C.Vec3(length / 2 + 0.03, halfHeight, (road.width + 64) / SCALE / 2)));
          body.quaternion.copy(quaternion); body.kind = 'bridge'; body.source = road;
          this.world.addBody(body); this.bridgeBodies.push(body);
        }
      }
      this._roads = roads;
    }

    _building(building) {
      // Source rectangles rotate around their centre, matching the world lot
      // footprint and the on-foot/ragdoll oriented boxes. The solid foundation
      // extends down the hill while the roof remains elevation + height.
      const base = finite(building.elevation), depth = Math.max(0, base - finite(building.foundationBottom, base));
      return this._fixed('building', building.x + building.w / 2, building.y + building.h / 2,
        [{ half: [building.w / 40, (building.height + depth) / 2, building.h / 40], offset: [0, (building.height - depth) / 2, 0] }], building);
    }

    _worldSize() {
      return clamp(finite(this.game.world?.size, finite(this.game.worldSize, finite(this.game.constructor?.SIZE, 2160))), 80, 20000);
    }

    _boundaries() {
      const size = this._worldSize(), bottom = Math.min(-8, finite(this.heightfield?.minValue) - 8);
      const top = Math.max(52, finite(this.heightfield?.maxValue) + 12), wallHeight = top - bottom, centre = (top + bottom) / 2;
      for (const body of this.world.bodies.slice()) if (body.kind === 'boundary') this.world.removeBody(body);
      this._fixed('boundary', -10, size / 2, [{ half: [0.5, wallHeight / 2, size / 40], offset: [0, centre, 0] }]);
      this._fixed('boundary', size + 10, size / 2, [{ half: [0.5, wallHeight / 2, size / 40], offset: [0, centre, 0] }]);
      this._fixed('boundary', size / 2, -10, [{ half: [size / 40, wallHeight / 2, 0.5], offset: [0, centre, 0] }]);
      this._fixed('boundary', size / 2, size + 10, [{ half: [size / 40, wallHeight / 2, 0.5], offset: [0, centre, 0] }]);
      this.size = size;
    }

    _fixed(kind, x, z, parts, source) {
      const body = new C.Body({ mass: 0, material: this.wallMaterial, position: new C.Vec3(x / SCALE, finite(source?.elevation), z / SCALE) });
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

    _syncEntry(entity, entry, clearControl = true) {
      const body = entry.body, old = entry.snapshot;
      const positionChanged = entity.x !== old.x || entity.y !== old.y || entity.elevation !== old.elevation;
      const angleChanged = entity.angle !== old.angle, orientationChanged = JSON.stringify(entity.orientation) !== old.orientation;
      if (positionChanged) { body.position.set(entity.x / SCALE, finite(entity.elevation) + entry.height / 2 + 0.004, entity.y / SCALE); body.wakeUp(); body.aabbNeedsUpdate = true; }
      if (orientationChanged && entity.orientation) { body.quaternion.set(entity.orientation.x, entity.orientation.y, entity.orientation.z, entity.orientation.w); body.wakeUp(); body.aabbNeedsUpdate = true; }
      else if (angleChanged) { body.quaternion.setFromEuler(0, -entity.angle, 0); body.wakeUp(); body.aabbNeedsUpdate = true; }
      if (entity.vx !== old.vx || entity.vy !== old.vy) { body.velocity.x = finite(entity.vx) / SCALE; body.velocity.z = finite(entity.vy) / SCALE; body.wakeUp(); }
      else if (entity.speed !== old.speed) { body.velocity.x = Math.cos(entity.angle) * entity.speed / SCALE; body.velocity.z = Math.sin(entity.angle) * entity.speed / SCALE; body.wakeUp(); }
      if (entity.verticalVelocity !== old.verticalVelocity) { body.velocity.y = finite(entity.verticalVelocity); body.wakeUp(); }
      if (clearControl) entry.control = null;
    }

    _body(entity) {
      let entry = this.bodies.get(entity.id);
      if (entry) return entry;
      const type = VehicleStats.getModel(entity), h = height(entity);
      const body = new C.Body({ mass: 700 * type.mass, material: this.carMaterial, linearDamping: 0.015, angularDamping: 0.28,
        sleepSpeedLimit: 0.08, sleepTimeLimit: 1.5, collisionFilterGroup: ROAD_VEHICLE_GROUP });
      body.addShape(new C.Box(new C.Vec3(type.length / 40, h / 2, type.width / 40)));
      const ground = this.groundHeight(entity.x, entity.y), elevation = finite(entity.elevation, ground);
      const groundedSpawn = !entity.orientation && Math.abs(elevation - ground) < 0.15;
      const pose = groundedSpawn && this._groundPose(entity.x, entity.y, entity.angle, body.shapes[0].halfExtents);
      body.position.set(entity.x / SCALE, pose ? pose.centreHeight : elevation + h / 2 + 0.004, entity.y / SCALE);
      if (entity.orientation) body.quaternion.set(entity.orientation.x, entity.orientation.y, entity.orientation.z, entity.orientation.w);
      else if (pose) body.quaternion.copy(pose.quaternion);
      else body.quaternion.setFromEuler(0, -finite(entity.angle), 0);
      body.velocity.set(finite(entity.vx, Math.cos(entity.angle) * entity.speed) / SCALE, finite(entity.verticalVelocity), finite(entity.vy, Math.sin(entity.angle) * entity.speed) / SCALE);
      if (entity.speed && !entity.vx && !entity.vy) body.velocity.set(Math.cos(entity.angle) * entity.speed / SCALE, finite(entity.verticalVelocity), Math.sin(entity.angle) * entity.speed / SCALE);
      body.entity = entity;
      entity.colliderHeight = h; entity.collisionHeight = h;
      body.addEventListener('collide', event => this._collision(body, event.body, event.contact));
      this.world.addBody(body);
      // Resting cars start with their parking brake set. Cannon sleep retains
      // the dynamic collider and wakes it for driving, blasts and collisions.
      if (pose && body.velocity.lengthSquared() < 0.0001) body.sleep();
      entry = { body, height: h, snapshot: this._snapshot(entity), control: null };
      this.bodies.set(entity.id, entry); return entry;
    }

    _syncAircraft(dt=0) {
      const alive=new Set();
      for(const entity of this.game.aircraft||[]) {
        const model=aircraftModel(entity);
        if(!model||entity.visible===false||entity.active===false||!Number.isFinite(entity.x)||!Number.isFinite(entity.y))continue;
        alive.add(entity.id);
        let entry=this.aircraftBodies.get(entity.id);
        if(!entry) {
          // Flight/rail controllers own these poses. Cannon only needs their
          // contacts with dynamic road cars; static/kinematic pairs cannot
          // resolve either pose and otherwise traverse entire terrain patches.
          const body=new C.Body({type:C.Body.KINEMATIC,mass:0,material:this.carMaterial,allowSleep:false,collisionFilterMask:ROAD_VEHICLE_GROUP});
          body.kind='aircraft';body.entity=entity;
          body.addShape(new C.Box(new C.Vec3(model.length/40,model.height/2,model.width/40)));
          this.world.addBody(body);
          entry={body,model,position:new C.Vec3(),quaternion:new C.Quaternion(),initialized:false};
          this.aircraftBodies.set(entity.id,entry);
        }
        const body=entry.body;
        body.entity=entity;
        if(entry.model!==model) {
          const shape=body.shapes[0];shape.halfExtents.set(model.length/40,model.height/2,model.width/40);
          shape.updateConvexPolyhedronRepresentation();shape.updateBoundingSphereRadius();body.updateBoundingRadius();entry.model=model;
        }
        entry.quaternion.copy(quaternion(entity));
        const offset=entry.quaternion.vmult(new C.Vec3(0,model.height/2,0));
        entry.position.set(entity.x/SCALE+offset.x,finite(entity.elevation)+offset.y,entity.y/SCALE+offset.z);
        if(dt>0&&entry.initialized) {
          // Aviation has already advanced this tick. Let Cannon interpolate
          // from the previous pose to that exact target, so contact velocity
          // is real without advancing the aircraft's flight model a second time.
          entry.position.vsub(body.position,body.velocity);body.velocity.scale(1/dt,body.velocity);
          const rotation=entry.quaternion.mult(body.quaternion.conjugate());
          if(rotation.w<0){rotation.x*=-1;rotation.y*=-1;rotation.z*=-1;rotation.w*=-1;}
          const amount=Math.hypot(rotation.x,rotation.y,rotation.z),angle=2*Math.atan2(amount,rotation.w);
          if(amount>.000001)body.angularVelocity.set(rotation.x/amount*angle/dt,rotation.y/amount*angle/dt,rotation.z/amount*angle/dt);
          else body.angularVelocity.setZero();
        } else {
          body.position.copy(entry.position);body.quaternion.copy(entry.quaternion);body.velocity.setZero();body.angularVelocity.setZero();
        }
        body.force.setZero();body.torque.setZero();body.aabbNeedsUpdate=true;entry.initialized=true;
        entity.colliderLength=model.length;entity.colliderWidth=model.width;entity.colliderHeight=model.height;entity.collisionHeight=model.height;
      }
      for(const [id,entry]of this.aircraftBodies)if(!alive.has(id)){this.world.removeBody(entry.body);this.aircraftBodies.delete(id);}
      this.world.broadphase.dirty=true;
    }

    _finishAircraftStep() {
      for(const entry of this.aircraftBodies.values()) {
        entry.body.position.copy(entry.position);entry.body.quaternion.copy(entry.quaternion);
        entry.body.aabbNeedsUpdate=true;
      }
      this.world.broadphase.dirty=true;
    }

    sync() {
      const terrainChanged = this._terrainModel !== this._terrain();
      if (terrainChanged) this._makeFloor();
      if (terrainChanged || this._roads !== (this.game.roads || this.game.world?.roads || NO_ROADS)) this._makeBridges();
      if (terrainChanged || this.size !== this._worldSize()) this._boundaries();
      if (this._buildings !== this.game.buildings || this._objects !== this.game.staticObjects) {
        for (const body of this.world.bodies.slice()) if (body.type === C.Body.STATIC && body !== this.floor && body.kind !== 'boundary' && body.kind !== 'bridge') this.world.removeBody(body);
        for (const building of this.game.buildings) this._building(building);
        for (const object of this.game.staticObjects) if (!object.destroyed) this._fixed(object.kind, object.x, object.y, object.parts, object);
        this._buildings = this.game.buildings; this._objects = this.game.staticObjects;
      }
      if (this._environmentVersion !== this.game._environmentVersion) {
        for (const body of this.world.bodies.slice()) if (body.source?.destroyed) this.world.removeBody(body);
        this._environmentVersion = this.game._environmentVersion;
      }
      const alive = new Set();
      for (const entity of this.game.cars.concat(this.game.police)) {
        alive.add(entity.id); const entry = this._body(entity);
        this._syncEntry(entity, entry);
      }
      for (const [id, entry] of this.bodies) if (!alive.has(id)) { this.world.removeBody(entry.body); this.bodies.delete(id); }
      this._syncAircraft();
    }

    control(entity, command) { if(!aircraftModel(entity))this._body(entity).control = command; }
    get(id) { return this.bodies.get(id)?.body || this.aircraftBodies.get(id)?.body || null; }

    // Blast vectors are changes in world-space velocity (metres per second).
    // Mirror only velocity fields so sync still detects pending teleports.
    impulse(entity, velocity) {
      if(aircraftModel(entity))return this.get(entity.id);
      const entry = this._body(entity), body = entry.body;
      this._syncEntry(entity, entry, false);
      body.applyImpulse(new C.Vec3(finite(velocity.x) * body.mass, finite(velocity.y) * body.mass, finite(velocity.z) * body.mass));
      body.freeRollUntil = this.world.time + 1;
      entity.vx = body.velocity.x * SCALE; entity.vy = body.velocity.z * SCALE; entity.verticalVelocity = body.velocity.y;
      entity.speed = entity.vx * Math.cos(finite(entity.angle)) + entity.vy * Math.sin(finite(entity.angle));
      for (const field of ['vx', 'vy', 'verticalVelocity', 'speed']) entry.snapshot[field] = entity[field];
      body.wakeUp(); return body;
    }

    _supported(body) {
      return this.world.contacts.some(contact => contact.bi === body && contact.ni.y < -0.65 || contact.bj === body && contact.ni.y > 0.65);
    }

    _nearGround(body, halfHeight, tolerance = 0.15) {
      if (Math.abs(body.position.y - halfHeight - this.groundHeight(body.position.x * SCALE, body.position.z * SCALE)) < tolerance) return true;
      const restingHeight = this._footprintHeight(body.position.x * SCALE, body.position.z * SCALE, body.quaternion, body.shapes[0].halfExtents);
      return Math.abs(body.position.y - restingHeight) < tolerance;
    }

    _contactNormal(body) {
      const normal = new C.Vec3();
      for (const contact of this.world.contacts) {
        const direction = contact.bi === body ? -1 : contact.bj === body ? 1 : 0;
        if (!direction || contact.ni.y * direction < 0.65) continue;
        normal.x += contact.ni.x * direction; normal.y += contact.ni.y * direction; normal.z += contact.ni.z * direction;
      }
      if (normal.lengthSquared() < 0.01) return this._surfaceNormal(body.position.x * SCALE, body.position.z * SCALE);
      normal.normalize(); return normal;
    }

    _drive(entry, dt) {
      const body = entry.body, entity = body.entity, command = entry.control, base = VehicleStats.getModel(entity), type = VehicleStats.performance(entity);
      const up = body.quaternion.vmult(new C.Vec3(0, 1, 0)), forward = body.quaternion.vmult(new C.Vec3(1, 0, 0));
      const grounded = (this._nearGround(body, entry.height / 2) || this._supported(body)) && up.y > 0.55;
      if (!grounded) return;
      const normal = this._contactNormal(body), alongNormal = this.world.gravity.dot(normal);
      const roadContact = this.world.contacts.some(contact =>
        (contact.bi === body && (contact.bj === this.floor || contact.bj.kind === 'bridge') ||
          contact.bj === body && (contact.bi === this.floor || contact.bi.kind === 'bridge')) && Math.abs(contact.ni.y) > 0.65);
      if (roadContact && this.world.time >= (body.freeRollUntil || 0)) {
        // A single chassis box has no wheel suspension. Bounded restoring
        // torque absorbs ordinary terrain pitch/roll while keeping impacts
        // and airborne rotations free to act on the real body.
        const error = up.cross(normal), spin = body.angularVelocity.dot(normal);
        const tilt = body.angularVelocity.vsub(normal.scale(spin));
        body.torque.x += body.mass * clamp(error.x * 8 - tilt.x * 4, -12, 12);
        body.torque.y += body.mass * clamp(error.y * 8 - tilt.y * 4, -12, 12);
        body.torque.z += body.mass * clamp(error.z * 8 - tilt.z * 4, -12, 12);
      }
      // Cancel gravity along the driving surface. Hills remain solid terrain,
      // while an ordinary compact can climb them and parked cars stay put.
      body.force.x -= body.mass * (this.world.gravity.x - normal.x * alongNormal);
      body.force.y -= body.mass * (this.world.gravity.y - normal.y * alongNormal);
      body.force.z -= body.mass * (this.world.gravity.z - normal.z * alongNormal);
      const normalForward = forward.dot(normal);
      forward.x -= normal.x * normalForward; forward.y -= normal.y * normalForward; forward.z -= normal.z * normalForward; forward.normalize();
      const side = forward.cross(normal), speed = body.velocity.dot(forward), lateral = body.velocity.dot(side);
      if (!command) {
        const vertical = body.velocity.dot(normal);
        body.force.x -= (body.velocity.x - normal.x * vertical) * body.mass * 0.5;
        body.force.y -= (body.velocity.y - normal.y * vertical) * body.mass * 0.5;
        body.force.z -= (body.velocity.z - normal.z * vertical) * body.mass * 0.5; return;
      }
      const heading = Math.atan2(forward.z, forward.x);
      const speedRatio = type.maxSpeed / base.maxSpeed;
      const max = (command.maxSpeed || base.maxSpeed) * speedRatio / SCALE, reverseMax = 5.5 * speedRatio;
      let acceleration = 0, steer = command.steer || 0;
      if (command.targetSpeed !== undefined) {
        const target = clamp(command.targetSpeed / SCALE, -reverseMax, max);
        acceleration = clamp((target - speed) * 4, -12, type.acceleration / SCALE);
        // A stalled engine can slow a forward-moving car, but cannot power
        // reverse or accelerate a car already rolling backwards.
        if (!type.driveable) acceleration = speed > 0 ? Math.min(0, acceleration) : 0;
        const error = Math.atan2(Math.sin(command.heading - heading), Math.cos(command.heading - heading));
        steer = clamp(error * 2, -1, 1);
      } else {
        if (command.up) acceleration += type.acceleration / SCALE * (command.boost ? 1.3 : 1);
        if (command.down) acceleration -= speed > 0.75 ? 35 : type.driveable ? 13 * type.acceleration / base.acceleration : 0;
        if (!command.up && !command.down) acceleration -= speed * 1.1;
      }
      if (type.driveable && speed > max) acceleration = Math.min(acceleration, (max - speed) * 8);
      if (type.driveable && speed < -reverseMax) acceleration = Math.max(acceleration, (-reverseMax - speed) * 8);
      if (command.brake) acceleration -= speed * 3.8;
      const grip = command.brake ? 2.4 * type.grip / base.grip : type.grip;
      body.force.x += body.mass * (forward.x * acceleration - side.x * lateral * grip);
      body.force.y += body.mass * (forward.y * acceleration - side.y * lateral * grip);
      body.force.z += body.mass * (forward.z * acceleration - side.z * lateral * grip);
      const yawRate = steer * type.handling * clamp(Math.abs(speed) / 7.5, 0.2, 1) * (command.brake ? 1.35 : 1) * Math.sign(speed);
      // Steering controls only yaw. Collision roll/pitch are never overwritten.
      body.angularVelocity.y += (-yawRate - body.angularVelocity.y) * Math.min(1, 8 * dt);
      body.wakeUp();
    }

    _collision(body, other, contact) {
      if (other === this.floor || other.kind === 'bridge') return;
      if (Math.abs(contact.ni.y) > 0.65) { contact.restitution = 0.08; return; }
      const closing = Math.abs(contact.getImpactVelocityAlongNormal());
      if (closing < 1.5) return;
      body.freeRollUntil = this.world.time + 0.8;
      this.impacts.push({ entity: body.entity, other: other.entity || null, prop: other.source || null, speed: closing * SCALE, vehicle: Boolean(other.entity) });
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
      this._syncAircraft(dt);
      // Two solver steps improve thin-post contacts and fast bumper impacts.
      for (let substep = 0; substep < 2; substep++) {
        for (const entry of this.bodies.values()) this._drive(entry, dt / 2);
        this.world.step(dt / 2);
        // Apply the extra lift after contact solving so the road constraint
        // cannot erase it during the same instant the bumper hits the wall.
        for (const { body, other, lift } of this._pendingLaunches.splice(0)) {
          body.applyImpulse(new C.Vec3(0, lift * body.mass, 0), new C.Vec3(0, 0, body.entity.id.length % 2 ? 0.24 : -0.24));
          if (other.entity && other.type===C.Body.DYNAMIC) other.applyImpulse(new C.Vec3(0, lift * other.mass * 0.8, 0), new C.Vec3(0.15, 0, 0));
          body.wakeUp(); if (other.entity) other.wakeUp();
        }
      }
      this._finishAircraftStep();
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
        entity.grounded = (this._nearGround(body, entry.height / 2, 0.12) || this._supported(body)) && entity.upright;
        entity.collisionHeight = entry.height; entry.snapshot = this._snapshot(entity);
      }
      return this.impacts;
    }

    reset(entity) {
      if(aircraftModel(entity)){this._syncAircraft();return this.get(entity.id);}
      const entry = this._body(entity), body = entry.body;
      const pose = this._groundPose(entity.x, entity.y, entity.angle, body.shapes[0].halfExtents);
      body.position.set(entity.x / SCALE, pose.centreHeight, entity.y / SCALE);
      body.quaternion.copy(pose.quaternion); body.velocity.setZero(); body.angularVelocity.setZero(); body.force.setZero(); body.torque.setZero();
      body.freeRollUntil = 0;
      entity.elevation = pose.elevation; entity.verticalVelocity = 0; entity.vx = entity.vy = entity.speed = 0; entity.grounded = true; entity.upright = body.quaternion.vmult(new C.Vec3(0, 1, 0)).y > 0.6;
      entity.orientation = { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w };
      entity.angularVelocity = { x: 0, y: 0, z: 0 }; entry.control = null; entry.snapshot = this._snapshot(entity); body.sleep(); body.aabbNeedsUpdate = true;
    }

    support(x, z, top = 100) {
      const ground = this.groundHeight(x, z), bottom = Math.min(-0.1, finite(this.heightfield?.minValue) - 1, ground - 1);
      const ray = this.world.raycastClosest(new C.Vec3(x / SCALE, top, z / SCALE), new C.Vec3(x / SCALE, bottom, z / SCALE), { skipBackfaces: true }, this._ray || (this._ray = new C.RaycastResult()));
      if (ray && this._ray.body === this.floor && !this.heightfield) return 0;
      return ray ? this._ray.hitPointWorld.y : ground;
    }

    hitsSegment(from, to) {
      return Boolean(this.firstHit(from, to));
    }

    firstHit(from, to, ignoreVehicleId, ignoreProps) {
      const result = new C.RaycastResult();
      const start = new C.Vec3(from.x / SCALE, from.height, from.y / SCALE), end = new C.Vec3(to.x / SCALE, to.height, to.y / SCALE);
      if (ignoreVehicleId || ignoreProps?.size) {
        let nearest = null;
        this.world.raycastAll(start, end, { skipBackfaces: false }, hit => {
          if (ignoreVehicleId && hit.body.entity?.id === ignoreVehicleId || ignoreProps?.has(hit.body.source) || nearest && nearest.distance <= hit.distance) return;
          nearest = { body: hit.body, source: hit.body.source, distance: hit.distance, x: hit.hitPointWorld.x * SCALE, y: hit.hitPointWorld.z * SCALE, height: hit.hitPointWorld.y };
        });
        return nearest;
      }
      const hit = this.world.raycastClosest(start, end, { skipBackfaces: false }, result);
      return hit ? { body: result.body, source: result.body.source, x: result.hitPointWorld.x * SCALE, y: result.hitPointWorld.z * SCALE, height: result.hitPointWorld.y } : null;
    }

    ceiling(x, z, fromHeight, toHeight) {
      let ceiling = Infinity;
      const radius = Physics.PLAYER_RADIUS / SCALE * 0.8;
      for (const [dx,dz] of [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]]) {
        const result = new C.RaycastResult();
        if (this.world.raycastClosest(new C.Vec3(x / SCALE + dx, fromHeight, z / SCALE + dz), new C.Vec3(x / SCALE + dx, toHeight, z / SCALE + dz), { skipBackfaces: false }, result)) ceiling = Math.min(ceiling, result.hitPointWorld.y);
      }
      return ceiling;
    }
  }
  root.MayhemVehiclePhysics = { VehicleWorld, height, personContact, quaternion, SCALE };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MayhemVehiclePhysics;
})(globalThis);
