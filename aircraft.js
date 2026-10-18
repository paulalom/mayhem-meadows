(function (root) {
  'use strict';

  // Aircraft use map x/y (20 units per metre) and metres for vertical motion,
  // just like the road vehicles. Their controller never inserts them into the
  // road chassis solver, so changing pilots does not change their flight model.
  const SCALE = 20;
  const VehicleStats = root.MayhemVehicleStats || (typeof require === 'function' ? require('./vehicle-stats.js') : null);
  const Physics = root.MayhemPhysics || (typeof require === 'function' ? require('./physics.js') : null);
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const approach = (value, target, rate, dt) => value + clamp(target - value, -rate * dt, rate * dt);
  const definition = (id, name, flightClass, stats) => Object.freeze({
    id, aircraftType: id, name, make: 'Meadows Aviation', model: name, class: flightClass, type: flightClass,
    category: flightClass, helicopter: flightClass === 'helicopter',
    maxSpeed: 600, acceleration: 115, handling: 1, mass: 1.5, durability: 1.5,
    engineDurability: 1.4, maxHealth: 160, length: 150, width: 185, height: 2.5,
    climbRate: 11, descentRate: 8, stallSpeed: 190, seats: 2, maxAltitude: 240,
    ...stats
  });
  const AIRCRAFT_TYPES = Object.freeze({
    trainer: definition('trainer', 'Bramble Skylark', 'plane', { maxSpeed: 650, acceleration: 105, handling: 1.1, length: 142, width: 211.6, height: 3.05 }),
    commuter: definition('commuter', 'Mirth Islander', 'plane', { maxSpeed: 820, acceleration: 95, handling: .73, mass: 3, maxHealth: 220, length: 257, width: 332, height: 5.1, stallSpeed: 220, seats: 8 }),
    helicopter: definition('helicopter', 'Pogo Whirlybird', 'helicopter', { maxSpeed: 440, acceleration: 180, handling: 1.3, length: 223.68, width: 204.16, height: 3.256, stallSpeed: 0, seats: 4 }),
    news: definition('news', 'Channel 6 Skywatch', 'helicopter', { maxSpeed: 455, acceleration: 170, handling: 1.25, length: 223.68, width: 204.16, height: 3.256, stallSpeed: 0, seats: 3 }),
    policeheli: definition('policeheli', 'Biscuit Air Patrol', 'helicopter', { maxSpeed: 490, acceleration: 185, handling: 1.2, length: 223.68, width: 204.16, height: 3.256, maxHealth: 240, stallSpeed: 0, seats: 4, sideGun: true }),
    transportheli: definition('transportheli', 'Tumble Heavy Lift', 'helicopter', { maxSpeed: 520, acceleration: 110, handling: .7, mass: 5, length: 343.6, width: 284.12, height: 5, maxHealth: 380, stallSpeed: 0, seats: 16 }),
    fighter: definition('fighter', 'Fable Firefly', 'plane', { maxSpeed: 1500, acceleration: 190, handling: 1.5, mass: 3.5, length: 284, width: 204.4, height: 4.35, climbRate: 24, descentRate: 17, stallSpeed: 340, maxAltitude: 360, maxHealth: 260, seats: 1 })
  });
  const isAircraft = entity => Boolean(entity && entity.kind === 'aircraft' && Object.hasOwn(AIRCRAFT_TYPES, entity.aircraftType));
  const getModel = entity => AIRCRAFT_TYPES[typeof entity === 'string' ? entity : entity?.aircraftType] || AIRCRAFT_TYPES.trainer;
  const roadModel = entity => {
    const model = VehicleStats?.getModel(entity);
    return model ? { ...model, height: model.height ?? (entity.kind === 'van' ? 1.7 : 1.3) } : { length: 48, width: 32, height: 1.7 };
  };
  function boardingDistance(entity,point) {
    const model=getModel(entity),c=Math.cos(finite(entity.angle)),s=Math.sin(finite(entity.angle)),dx=point.x-entity.x,dy=point.y-entity.y;
    return Math.hypot(Math.max(0,Math.abs(dx*c+dy*s)-model.length/2),Math.max(0,Math.abs(-dx*s+dy*c)-model.width/2));
  }

  function inBox(point, box, margin = 0) {
    const angle = finite(box.angle), c = Math.cos(angle), s = Math.sin(angle);
    const dx = point.x - (box.x + box.w / 2), dy = point.y - (box.y + box.h / 2);
    return Math.abs(dx * c + dy * s) <= box.w / 2 + margin && Math.abs(-dx * s + dy * c) <= box.h / 2 + margin;
  }

  // Slab intersection includes elevation; a round fired over a roof must not
  // hit the flat building footprint. Padding allows a swept fuselage/wing tip.
  function segmentBox(a, b, box, bottom, height, padding = 0) {
    const angle = finite(box.angle), c = Math.cos(angle), s = Math.sin(angle);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const local = point => [(point.x - cx) * c + (point.y - cy) * s, -(point.x - cx) * s + (point.y - cy) * c, finite(point.elevation, finite(point.height))];
    const p = local(a), q = local(b);
    let low = 0, high = 1;
    for (const [axis, min, max] of [[0, -box.w / 2 - padding, box.w / 2 + padding], [1, -box.h / 2 - padding, box.h / 2 + padding], [2, bottom, bottom + height]]) {
      const delta = q[axis] - p[axis];
      if (Math.abs(delta) < 1e-8) { if (p[axis] < min || p[axis] > max) return null; }
      else {
        let near = (min - p[axis]) / delta, far = (max - p[axis]) / delta;
        if (near > far) [near, far] = [far, near];
        low = Math.max(low, near); high = Math.min(high, far);
        if (low > high) return null;
      }
    }
    return low;
  }

  function footprintOverlap(a, am, b, bm, margin = 0) {
    const box = (entity, model) => ({
      x: entity.x, y: entity.y,
      axes: [{ x: Math.cos(finite(entity.angle)), y: Math.sin(finite(entity.angle)) }, { x: -Math.sin(finite(entity.angle)), y: Math.cos(finite(entity.angle)) }],
      half: [model.length / 2 + margin, model.width / 2 + margin]
    });
    const aa = box(a, am), bb = box(b, bm);
    for (const axis of aa.axes.concat(bb.axes)) {
      const project = item => item.half.reduce((sum, half, i) => sum + half * Math.abs(axis.x * item.axes[i].x + axis.y * item.axes[i].y), 0);
      if (Math.abs((aa.x - bb.x) * axis.x + (aa.y - bb.y) * axis.y) >= project(aa) + project(bb)) return false;
    }
    return true;
  }

  class AircraftSystem {
    constructor(game, options = {}) {
      this.game = game; this.aircraft = []; this.aircraftProjectiles = [];
      this.time = 0; this._nextId = 1; this.airports = {};
      // Keep the original civilian aliases available to the HUD and tools.
      // A remote airstrip owns its own runway and ground-traffic clearance.
      Object.defineProperty(this, 'runwayReservation', {
        get: () => this.airports.civilian?.runwayReservation || null,
        set: value => { if (this.airports.civilian) this.airports.civilian.runwayReservation = value; }
      });
      this.policeWarning = 0; this._highHeatTime = 0; this._newsHeatTime = 0;
      this._policeCooldown = 0; this._newsCooldown = 0; this._dispatchLocation = null;
      this.militaryWarning = 0; this._militaryHeatTime = 0; this._militaryCooldown = 0; this._militaryIncident = null;
      this.militaryStatus = { active: false, type: null, phase: 'standby', label: 'Northwatch standing by', seen: false };
      this._airport = game.world?.landscape?.airport || {};
      this._configureAirport();
      game.aircraftProjectiles = this.aircraftProjectiles;
      game.airPoliceSeen = false;
      if (options.spawn !== false) this._populate();
    }

    get current() { return this.aircraft.find(entity => entity.id === this.game.player?.vehicleId) || null; }
    get militaryResponse() { return this.aircraft.find(entity => entity.militaryResponse && entity.npc && entity.health > 0 && !entity.exploded && !['parked', 'wrecked'].includes(entity.flightPhase)) || null; }
    model(entity) { return getModel(entity); }
    _ground(point) { return finite(this.game._ground?.(point), finite(this.game.world?.terrain?.surfaceHeight?.(point.x, point.y))); }
    _toast(text, kind) { this.game._toast?.(text, kind); }
    _phase(entity, phase) { entity.phase = entity.flightPhase = phase; entity.phaseTime = 0; }

    _configureAirport() {
      const civilian = this._configureField(this._airport, 'civilian');
      this.airports.civilian = civilian;
      for (const key of ['runway', 'threshold', 'heading', 'runwayEnd', 'approach', 'stands', 'helipads']) this[key] = civilian[key];
      const military = this.game.world?.landscape?.militaryBase || this.game.world?.militaryBase;
      if (military?.runways?.length) this.airports.military = this._configureField(military, 'military');
      const world = this.game.world || {}, ground = world.groundBounds || world.bounds || {};
      this.bounds = { minX: finite(ground.minX) - 4200, minY: finite(ground.minY) - 4200, maxX: finite(ground.maxX, finite(world.mapWidth, finite(world.size, 12000))) + 4200, maxY: finite(ground.maxY, finite(world.mapHeight, 8000)) + 4200, ...world.landscape?.airspace };
    }

    _configureField(airport, id) {
      const runway = airport.runways?.[0] || { x: 10920, y: 2300, w: 280, h: 2200, angle: 0 };
      const center = { x: runway.x + runway.w / 2, y: runway.y + runway.h / 2 };
      const angle = finite(runway.angle) + (runway.h >= runway.w ? -Math.PI / 2 : 0);
      const length = Math.max(runway.w, runway.h), along = offset => ({ x: center.x + Math.cos(angle) * offset, y: center.y + Math.sin(angle) * offset, angle });
      const selected = runway.thresholds?.find(point => point.id === airport.departureThresholdId) || runway.thresholds?.find(point => Math.abs(wrap(finite(point.angle) - angle)) < .1);
      const threshold = selected ? { ...selected } : along(-length / 2 + 140);
      threshold.angle = finite(threshold.angle, angle);
      const heading = threshold.angle;
      const runwayEnd = runway.thresholds?.find(point => point !== selected && distance(point, threshold) > length * .5) || {
        x: threshold.x + Math.cos(heading) * (length - 280), y: threshold.y + Math.sin(heading) * (length - 280)
      };
      const approach = { x: threshold.x - Math.cos(heading) * 4500, y: threshold.y - Math.sin(heading) * 4500, elevation: this._ground(threshold) + 75 };
      const apron = airport.aprons?.[0] || { x: 10370, y: 2850, w: 390, h: 1900 };
      const stands = airport.stands?.length ? airport.stands : id === 'military' ? [] : [
        { id: 'trainer-1', aircraftType: 'trainer', x: apron.x + apron.w / 2, y: apron.y + 180, angle: 0 },
        { id: 'trainer-2', aircraftType: 'trainer', x: apron.x + apron.w / 2, y: apron.y + 490, angle: 0 },
        { id: 'commuter-1', aircraftType: 'commuter', x: apron.x + apron.w / 2, y: apron.y + 820, angle: 0 }
      ];
      const helipads = airport.helipads?.length ? airport.helipads : id === 'military' ? [] : [
        { id: 'heli-civilian', aircraftType: 'helicopter', x: apron.x + apron.w / 2, y: apron.y + 1190, angle: 0, radius: 110 },
        { id: 'heli-news', aircraftType: 'news', x: apron.x + apron.w / 2, y: apron.y + 1510, angle: 0, radius: 110 },
        { id: 'heli-police', aircraftType: 'policeheli', x: apron.x + apron.w / 2, y: apron.y + 1830, angle: 0, radius: 110 }
      ];
      return { id, airport, runway, threshold, heading, runwayEnd, approach, stands, helipads, runwayReservation: null };
    }

    _field(entity) { return this.airports[typeof entity === 'string' ? entity : entity?.airportId] || this.airports.civilian; }

    airportAt(point) {
      if (!point) return null;
      const fields = Object.values(this.airports);
      const named = fields.find(field => field.stands.concat(field.helipads, field.airport.storageStands || []).some(stand => stand === point || stand.id && stand.id === point.id));
      return named?.id || fields.find(field => (field.airport.aprons || []).some(apron => inBox(point, apron, 180)) || field.helipads.some(pad => distance(point, pad) < finite(pad.radius, 110) + 100))?.id || null;
    }

    _releaseRunway(entity) {
      for (const field of Object.values(this.airports)) if (field.runwayReservation === entity.id) field.runwayReservation = null;
    }

    _populate() {
      for (const [index, stand] of this.stands.entries()) {
        const type = Object.hasOwn(AIRCRAFT_TYPES, stand.aircraftType) ? stand.aircraftType : /commuter/i.test(stand.id || '') ? 'commuter' : 'trainer';
        this.spawn(type, stand, { standId: stand.id, npc: index > 0, departureDelay: index === 1 ? 35 : 12 });
      }
      const padTypes = ['helicopter', 'news', 'policeheli'];
      this.helipads.forEach((pad, index) => { if (!pad.noSpawn) this.spawn(Object.hasOwn(AIRCRAFT_TYPES, pad.aircraftType) ? pad.aircraftType : padTypes[index % 3], pad, { standId: pad.id }); });
      if (this.airports.military) {
        const field = this.airports.military;
        for (const stand of field.stands.concat(field.helipads)) {
          if (!stand.noSpawn) this.spawn(stand.aircraftType || 'fighter', stand, { standId: stand.id, airportId: field.id, npc: Boolean(stand.npc), departureDelay: finite(stand.departureDelay, 70) });
        }
      } else for (const stand of this._airport.militaryStands || []) this.spawn(stand.aircraftType || 'transportheli', stand, { standId: stand.id });
      const taxiPad = this.helipads.find(pad => pad.airTaxi), townPad = this.game.world?.landscape?.helipads?.find(pad => /marina/.test(pad.id || ''));
      if (taxiPad && townPad) this.spawn('helicopter', townPad, { npc: true, npcRole: 'air-taxi', routePads: [{ ...townPad }, { ...taxiPad }], routeIndex: 1, flightPhase: 'boarding', phase: 'boarding', departureDelay: 6 });
    }

    spawn(type = 'trainer', position, options = {}) {
      if (!Object.hasOwn(AIRCRAFT_TYPES, type)) return null;
      position ||= this.parkingPosition(type);
      if (!position) return null;
      const model = AIRCRAFT_TYPES[type];
      const airportId = options.airportId || this.airportAt(position) || 'civilian';
      const entity = {
        id: 'aircraft-' + this._nextId++, kind: 'aircraft', aircraftType: type, modelId: type,
        x: finite(position.x), y: finite(position.y), angle: finite(position.angle),
        elevation: finite(position.elevation, this._ground(position)), vz: 0, verticalVelocity: 0,
        speed: 0, vx: 0, vy: 0, pitch: 0, roll: 0, throttle: 0, rotorAngle: 0,
        grounded: true, upright: true, health: model.maxHealth, maxHealth: model.maxHealth,
        engineHealth: 100, handlingHealth: 100, burning: false, exploded: false,
        visible: true, npc: Boolean(options.npc), traffic: false, borrowed: false,
        standId: options.standId || position.id, airportId, home: { ...position }, phase: 'parked', flightPhase: 'parked',
        phaseTime: 0, departureDelay: finite(options.departureDelay, 20), passengers: 0,
        altitudeAGL: 0, agl: 0, stalled: false, stallWarning: false, gunCooldown: 0,
        ...options
      };
      entity.grounded = entity.elevation <= this._support(entity, entity.elevation + .1) + .05;
      this.aircraft.push(entity);
      return entity;
    }

    clearPosition(entity, position, ignore = entity) {
      const model = getModel(entity), candidate = { ...position, angle: finite(position.angle), elevation: finite(position.elevation, this._ground(position)) };
      const world = this.game.world || {}, bounds = world.groundBounds || world.bounds || {};
      const minX = finite(bounds.minX), minY = finite(bounds.minY), maxX = finite(bounds.maxX, finite(world.mapWidth, finite(world.size, 12000))), maxY = finite(bounds.maxY, finite(world.mapHeight, 8000));
      const c = Math.abs(Math.cos(candidate.angle)), s = Math.abs(Math.sin(candidate.angle)), halfX = (model.length * c + model.width * s) / 2, halfY = (model.length * s + model.width * c) / 2;
      if (candidate.x < minX + halfX || candidate.y < minY + halfY || candidate.x > maxX - halfX || candidate.y > maxY - halfY) return false;
      const terrain = world.terrain;
      if (terrain?.isWater?.(candidate.x, candidate.y) && candidate.elevation < finite(terrain.waterLevel) + .3) return false;
      const bottom = candidate.elevation, top = bottom + model.height;
      for (const building of this.game.buildings || []) {
        const base = finite(building.elevation, this._ground({ x: building.x + building.w / 2, y: building.y + building.h / 2 }));
        if (top <= base || bottom >= base + finite(building.height, 8) - .025) continue;
        const other = { x: building.x + building.w / 2, y: building.y + building.h / 2, angle: building.angle };
        if (footprintOverlap(candidate, model, other, { length: building.w, width: building.h }, 10)) return false;
      }
      for (const other of this.aircraft.concat(this.game.cars || [], this.game.police || [])) {
        if (other === ignore || other.id === ignore?.id || other.visible === false) continue;
        const otherModel = isAircraft(other) ? getModel(other) : roadModel(other);
        if (top <= finite(other.elevation) || bottom >= finite(other.elevation) + otherModel.height) continue;
        if (footprintOverlap(candidate, model, other, otherModel, 12)) return false;
      }
      for (const person of (this.game.peds || []).concat(this.game.player?.vehicleId ? [] : [this.game.player].filter(Boolean))) {
        if (person.transportedBy || person === ignore || person.id === ignore?.id || top <= finite(person.elevation) || bottom >= finite(person.elevation) + 1.9) continue;
        if (footprintOverlap(candidate, model, person, { length: 24, width: 24 }, 12)) return false;
      }
      for (const object of this.game.staticObjects || []) {
        if (object.destroyed) continue;
        for (const part of object.parts || []) {
          const c = Math.cos(finite(object.angle)), s = Math.sin(finite(object.angle)), offset = part.offset || [0, 0, 0], half = part.half || [.3, .5, .3];
          const base = finite(object.elevation, this._ground(object)) + offset[1] - half[1];
          if (top <= base || bottom >= base + half[1] * 2) continue;
          const center = { x: object.x + (offset[0] * c - offset[2] * s) * SCALE, y: object.y + (offset[0] * s + offset[2] * c) * SCALE, angle: object.angle };
          if (footprintOverlap(candidate, model, center, { length: half[0] * 40, width: half[2] * 40 }, 8)) return false;
        }
      }
      return true;
    }

    parkingPosition(type, ignore, airportId) {
      const model = getModel(type), field = this._field(airportId || ignore || (['fighter', 'transportheli'].includes(model.id) && this.airports.military ? 'military' : 'civilian'));
      const airport = field.airport, pads = (airport.militaryStands || []).filter(stand => stand.aircraftType === model.id)
        .concat(airport.storageStands || [], model.class === 'helicopter' ? field.helipads.filter(pad => !pad.airTaxi) : field.stands);
      if (ignore?.home && this._field(ignore) === field) {
        const home = { ...ignore.home, elevation: finite(ignore.home.elevation, this._ground(ignore.home)) };
        if (this.clearPosition(model.id, home, ignore)) return home;
      }
      const ordered = [...pads].sort((a, b) => Number(b.aircraftType === model.id) - Number(a.aircraftType === model.id));
      for (const pad of ordered) {
        const candidate = { ...pad, elevation: finite(pad.elevation, this._ground(pad)) };
        if (this.clearPosition(model.id, candidate, ignore)) return candidate;
      }
      // Overflow stays on the prepared apron; never put a recovered plane in a
      // live runway or taxiway simply because its original stand is occupied.
      for (const apron of airport.aprons || []) {
        for (let y = apron.y + model.width / 2 + 20; y <= apron.y + apron.h - model.width / 2 - 20; y += model.width + 35) {
          for (let x = apron.x + model.length / 2 + 20; x <= apron.x + apron.w - model.length / 2 - 20; x += model.length + 35) {
            const candidate = { x, y, angle: 0, elevation: this._ground({ x, y }) };
            if (this.clearPosition(model.id, candidate, ignore)) return candidate;
          }
        }
      }
      return null;
    }
    findParking(type, ignore, airportId) { return this.parkingPosition(type, ignore, airportId); }

    enterNearest() {
      if (this.current) return this.interact();
      const player = this.game.player;
      if (!player || player.vehicleId || player.grounded === false || player.parachuting || this.game.ragdolls?.get?.(player.id)) return false;
      const nearest = this.aircraft.filter(entity => entity.visible !== false && entity.grounded && entity.health > 0 && !entity.exploded && !entity.burning && Math.abs(entity.speed) < 30 && Math.abs(entity.elevation - finite(player.elevation)) < 3 && boardingDistance(entity,player)<65)
        .sort((a, b) => boardingDistance(a,player)-boardingDistance(b,player) || distance(a,player)-distance(b,player))[0];
      if (!nearest) return false;
      player.vehicleId = nearest.id; nearest.npc = false; nearest.borrowed = true; nearest.throttle = 0;
      this._phase(nearest, 'player');
      this._releaseRunway(nearest);
      this._syncPlayer(nearest);
      this._toast(getModel(nearest).name + ': Space climbs, Ctrl descends, F opens your parachute.');
      return true;
    }

    interact() {
      const entity = this.current;
      if (!entity) return this.enterNearest();
      if (!entity.grounded || Math.abs(entity.speed) > 35) { this._toast('Land and slow down before leaving. F deploys a parachute in flight.'); return false; }
      const model = getModel(entity), player = this.game.player;
      for (const offset of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
        const radius = (Math.abs(Math.sin(offset)) > .5 ? model.width : model.length) / 2 + 28;
        const point = { x: entity.x + Math.cos(entity.angle + offset) * radius, y: entity.y + Math.sin(entity.angle + offset) * radius, elevation: entity.elevation };
        const support = this._support(point, entity.elevation + .2);
        if (Math.abs(support - entity.elevation) > .5 || this.game._isFree && !this.game._isFree(point.x, point.y, 12, support)) continue;
        const person={...point,elevation:support};
        if(this.game._personVehicleContact && this.aircraft.concat(this.game.cars || [],this.game.police || []).some(other=>other!==entity && other.visible!==false && this.game._personVehicleContact(person,other,12))) continue;
        if((this.game.peds || []).some(ped=>!ped.transportedBy && Math.abs(finite(ped.elevation)-support)<1.9 && distance(ped,person)<28)) continue;
        Object.assign(player, point, { vehicleId: null, elevation: support, verticalVelocity: 0, vz: 0, grounded: true, parachuting: false });
        entity.throttle = 0; entity.npc = false; this._phase(entity, 'parked');
        this._toast('Aircraft parked.'); return true;
      }
      this._toast('The door is blocked. Move to a clearer landing spot.');
      return false;
    }

    bailOut() {
      const entity = this.current;
      if (!entity) return false;
      if (entity.grounded && Math.abs(entity.speed) < 35) return this.interact();
      const player = this.game.player;
      const side = entity.angle + Math.PI / 2;
      Object.assign(player, { vehicleId: null, x: entity.x + Math.cos(side) * (getModel(entity).width / 2 + 20), y: entity.y + Math.sin(side) * (getModel(entity).width / 2 + 20), elevation: entity.elevation + 1.5,
        grounded: false, verticalVelocity: Math.min(2, entity.vz), vz: Math.min(2, entity.vz), vx: entity.vx, vy: entity.vy, parachuting: true });
      entity.npc = false; entity.throttle = 0; this._phase(entity, 'abandoned');
      this._toast('Parachute deployed. Steer toward a clear landing.'); return true;
    }

    recover(entity = this.current) {
      if (!isAircraft(entity)) return false;
      const position = this.parkingPosition(entity.aircraftType, entity);
      if (!position) { this._toast('All suitable aircraft stands are occupied. Clear a stand first.'); return false; }
      Object.assign(entity, { x: position.x, y: position.y, angle: finite(position.angle), elevation: finite(position.elevation, this._ground(position)),
        speed: 0, vx: 0, vy: 0, vz: 0, verticalVelocity: 0, pitch: 0, roll: 0, throttle: 0, grounded: true, upright: true, visible: true,
        npc: false, borrowed: true, altitudeAGL: 0, agl: 0 });
      this._phase(entity, this.current === entity ? 'player' : 'parked');
      this._releaseRunway(entity);
      if (this.current === entity) this._syncPlayer(entity);
      this._toast('Aircraft recovered at a clear airport stand.', 'success'); return true;
    }

    damage(entity, amount) {
      if (!isAircraft(entity) || entity.exploded || !Number.isFinite(amount) || amount <= 0) return false;
      entity.health = Math.max(0, entity.health - amount);
      entity.engineHealth = Math.max(0, entity.engineHealth - amount * .65);
      entity.handlingHealth = Math.max(0, entity.handlingHealth - amount * .45);
      if (entity.engineHealth <= 20 || entity.health <= entity.maxHealth * .18) {
        if (!entity.burning) {
          entity.burning = true; entity.fireTime = 0;
          if (entity === this.current || distance(entity, this.game.current || this.game.player || entity) < 500) this._toast('Aircraft engine fire! Land or press F to bail out.', 'warning');
        }
      }
      if (entity.health <= 0) { entity.throttle = 0; entity.npc = false; this._phase(entity, 'wrecked'); }
      return true;
    }

    hitSegment(from, to, amount = 30, ignoreId) {
      let closest = null;
      for (const entity of this.aircraft) {
        if (entity.id === ignoreId || entity.visible === false || entity.exploded) continue;
        const model = getModel(entity), box = { x: entity.x - model.length / 2, y: entity.y - model.width / 2, w: model.length, h: model.width, angle: entity.angle };
        const hit = segmentBox(from, to, box, entity.elevation, model.height);
        if (hit !== null && (!closest || hit < closest.hit)) closest = { entity, hit };
      }
      if (!closest) return false;
      this.damage(closest.entity, amount); return true;
    }

    step(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      let remaining = Math.min(dt, .25);
      while (remaining > 1e-8) { const tick = Math.min(remaining, 1 / 60); this._step(tick, input); remaining -= tick; }
    }

    _step(dt, input) {
      this.time += dt;
      this.game.airPoliceSeen = false;
      this._dispatch(dt);
      const current = this.current;
      for (const entity of this.aircraft) {
        entity.phaseTime += dt; entity.gunFiring = false; entity.gunCooldown = Math.max(0, entity.gunCooldown - dt);
        if (entity.visible === false) { this._npc(entity, dt); continue; }
        if (entity.burning && !entity.exploded) {
          entity.fireTime += dt; this.damage(entity, dt * 3);
          if (entity.fireTime > 10) {
            entity.exploded = true; entity.burning = false; entity.engineHealth = 0; entity.health = 0; entity.explosionTime = finite(this.game.time, this.time);
            this.game._confetti?.(entity.x, entity.y, 55, entity.elevation + 1);
            this.game._sound?.('explosion', { x: entity.x, y: entity.y, intensity: .8 });
            this.game._onAircraftExplosion?.(entity);
            if (entity === current) this.bailOut();
          }
        }
        let command = {};
        if (entity === current) command = input;
        else if (entity.npc && entity.health > 0 && !entity.exploded) command = this._npc(entity, dt) || {};
        else if (entity.flightPhase === 'abandoned' || entity.health <= 0) command = { down: true, descend: true };
        this._fly(entity, dt, command);
        const running = entity === this.current || entity.throttle > .04 || entity.npc && entity.flightPhase !== 'parked';
        const powered = entity.engineHealth > 0 && entity.health > 0 && !entity.exploded;
        const rotorSpeed = powered && running ? 22 + entity.throttle * 25 : entity.grounded ? 0 : 4;
        entity.rotorAngle = wrap(entity.rotorAngle + dt * rotorSpeed);
        if (entity.militaryRole === 'interceptor' && entity.militaryResponse && command.fire) this._fireForward(entity, command.target);
        else if ((getModel(entity).sideGun || entity.militaryResponse) && command.fire) this._fire(entity, command.aimAngle, command.target, command.aimPitch);
        if (entity === current && this.current === entity) this._syncPlayer(entity);
      }
      this._projectiles(dt);
    }

    _syncPlayer(entity) {
      Object.assign(this.game.player, { x: entity.x, y: entity.y, elevation: entity.elevation, angle: entity.angle, grounded: entity.grounded, verticalVelocity: entity.vz, vz: entity.vz });
    }

    _support(point, ceiling = Infinity) {
      let height = this._ground(point);
      for (const building of this.game.buildings || []) {
        if (!inBox(point, building)) continue;
        const top = finite(building.elevation, this._ground({ x: building.x + building.w / 2, y: building.y + building.h / 2 })) + finite(building.height, 8);
        if (top <= ceiling + .025) height = Math.max(height, top);
      }
      return height;
    }

    _fly(entity, dt, input) {
      const model = getModel(entity), heli = model.class === 'helicopter';
      const engine = entity.health > 0 && !entity.exploded ? clamp(entity.engineHealth / 100, 0, 1) : 0;
      const steering = model.handling * (.4 + .6 * clamp(entity.handlingHealth / 100, 0, 1));
      const turn = Number(Boolean(input.right)) - Number(Boolean(input.left));
      const climb = Number(Boolean(input.climb || input.ascend || input.jump)) - Number(Boolean(input.descend || input.crouch));
      const forward = Number(Boolean(input.up)) - Number(Boolean(input.down));
      const before = { x: entity.x, y: entity.y, elevation: entity.elevation };
      if (Number.isFinite(input.throttle)) entity.throttle = clamp(input.throttle, 0, 1);
      else if (heli) entity.throttle = engine > 0 && (!entity.grounded || climb > 0 || forward !== 0) ? .6 + .35 * Math.abs(forward) : 0;
      else entity.throttle = clamp(entity.throttle + forward * .6 * dt, 0, 1);
      if (!engine) entity.throttle = 0;
      const speedFactor = heli ? 1 : clamp(Math.abs(entity.speed) / Math.max(1, model.stallSpeed), .2, 1.5);
      entity.angle = wrap(entity.angle + turn * steering * (heli ? 1.15 : entity.grounded ? 1.2 : .75 * speedFactor) * dt);
      entity.roll = approach(entity.roll, entity.grounded ? 0 : turn * (heli ? .32 : .62), 1.6, dt);
      if (heli) {
        const desired = forward * model.maxSpeed * engine * (input.boost || input.hover ? .18 : 1);
        const response = input.boost || input.hover ? model.acceleration * 2.6 : model.acceleration;
        entity.speed = approach(entity.speed, desired, response * (engine || .6), dt);
        const vertical = engine ? finite(input.verticalSpeed, climb > 0 ? model.climbRate * engine : climb < 0 ? -model.descentRate : 0) : -12;
        entity.vz = approach(entity.vz, vertical, 13, dt);
        entity.pitch = approach(entity.pitch, clamp(entity.speed / model.maxSpeed, -.6, 1) * -.23, 1.1, dt);
        if (climb > 0 && engine > .1) entity.grounded = false;
      } else {
        const maximum = model.maxSpeed * engine * (input.boost ? 1.15 : 1);
        const target = entity.throttle * maximum;
        entity.speed = approach(entity.speed, target, target > entity.speed ? model.acceleration * Math.max(.15, engine) : model.acceleration * .6, dt);
        const lift = clamp((entity.speed - model.stallSpeed * .65) / (model.stallSpeed * .55), 0, 1);
        entity.stalled = !entity.grounded && entity.speed < model.stallSpeed * .8;
        entity.stallWarning = !entity.grounded && entity.speed < model.stallSpeed * 1.08;
        let vertical = finite(input.verticalSpeed, climb * (climb > 0 ? model.climbRate : model.descentRate)) * lift;
        if (entity.stalled) vertical = -3 - (1 - lift) * 8;
        else if (!engine) vertical = -4;
        if (entity.grounded && entity.speed > model.stallSpeed * 1.12 && climb >= 0 && engine > .1) { entity.grounded = false; vertical = Math.max(vertical, 2); }
        entity.vz = approach(entity.vz, vertical, 8, dt);
        entity.pitch = approach(entity.pitch, clamp(Math.atan2(entity.vz, Math.max(6, entity.speed / SCALE)), -.5, .5), 1.25, dt);
      }
      const ceiling = model.maxAltitude + this._ground(entity);
      if (entity.elevation > ceiling && entity.vz > 0) entity.vz = approach(entity.vz, -2, 25, dt);
      entity.vx = Math.cos(entity.angle) * entity.speed; entity.vy = Math.sin(entity.angle) * entity.speed;
      entity.x += entity.vx * dt; entity.y += entity.vy * dt; entity.elevation += entity.vz * dt;
      this._boundary(entity, dt);
      const floor = this._support(entity, Math.max(before.elevation, entity.elevation) + .1);
      if (entity.elevation < floor || entity.vz <= 0 && entity.elevation <= floor + .015) {
        const impact = Math.abs(Math.min(0, entity.vz));
        // Holding descend is a normal helicopter landing. Leave extra margin
        // beyond that controlled sink rate and damage only the excess speed.
        const safeLandingSpeed = heli ? model.descentRate * 1.5 : 4.5;
        const hardLanding = !entity.grounded && impact > safeLandingSpeed, wingStrike = !heli && !entity.grounded && Math.abs(entity.roll) > .42;
        if (hardLanding) this.damage(entity, (impact - (heli ? safeLandingSpeed : 3)) * 9);
        if (wingStrike) this.damage(entity, Math.abs(entity.roll) * 25);
        if ((hardLanding || wingStrike) && entity === this.current && this.game.missionStats && this.time - finite(entity._landingAt, -10) > .55) {
          this.game.missionStats.collisions++; entity._landingAt = this.time;
        }
        entity.elevation = floor; entity.vz = 0; entity.grounded = true;
        if (entity.exploded) entity.speed = approach(entity.speed, 0, 120, dt);
      } else entity.grounded = false;
      this._collide(entity, before);
      entity.verticalVelocity = entity.vz;
      entity.altitudeAGL = entity.agl = Math.max(0, entity.elevation - this._ground(entity));
      if (heli) entity.stalled = entity.stallWarning = false;
    }

    _boundary(entity, dt) {
      const bounds = this.bounds;
      const outside = entity.x < bounds.minX || entity.x > bounds.maxX || entity.y < bounds.minY || entity.y > bounds.maxY;
      if (!outside) { entity.boundaryWarning = false; return; }
      const target = Math.atan2((bounds.minY + bounds.maxY) / 2 - entity.y, (bounds.minX + bounds.maxX) / 2 - entity.x);
      entity.angle = wrap(entity.angle + clamp(wrap(target - entity.angle), -1.4 * dt, 1.4 * dt));
      entity.x = clamp(entity.x, bounds.minX - 650, bounds.maxX + 650); entity.y = clamp(entity.y, bounds.minY - 650, bounds.maxY + 650);
      if (!entity.boundaryWarning && entity === this.current) this._toast('Leaving local airspace. Flight assist is turning you back.');
      entity.boundaryWarning = true;
    }

    _collide(entity, before) {
      if (entity.exploded && entity.grounded) return;
      const model = getModel(entity), delta = { x: entity.x - before.x, y: entity.y - before.y, elevation: entity.elevation - before.elevation };
      const bodyRadius = Math.min(model.width * .22, model.length * .22), padding = 10;
      let hit = null;
      const consider = (box, bottom, height, other, prop) => {
        if (Math.max(before.elevation, entity.elevation) >= bottom + height - .03 || Math.min(before.elevation, entity.elevation) + model.height <= bottom + .03) return;
        // Sweep the fuselage and both wing tips/rotor edges. Ground landing is
        // resolved first, allowing roofs to support aircraft from above.
        const samples = [[0, 0], [model.length * .25, 0], [-model.length * .25, 0], [model.length * .48, 0], [-model.length * .48, 0], [0, model.width * .25], [0, -model.width * .25], [0, model.width * .48], [0, -model.width * .48]];
        for (const [forward, side] of samples) {
          const ox = Math.cos(entity.angle) * forward - Math.sin(entity.angle) * side, oy = Math.sin(entity.angle) * forward + Math.cos(entity.angle) * side;
          const a = { x: before.x + ox, y: before.y + oy, elevation: before.elevation + model.height * .45 };
          const b = { x: entity.x + ox, y: entity.y + oy, elevation: entity.elevation + model.height * .45 };
          const fraction = segmentBox(a, b, box, bottom - model.height * .4, height + model.height * .8, padding);
          if (fraction !== null && (!hit || fraction < hit.fraction)) hit = { fraction, other, prop };
        }
      };
      for (const building of this.game.buildings || []) {
        if (Math.min(before.x, entity.x) > building.x + building.w + model.length || Math.max(before.x, entity.x) < building.x - model.length || Math.min(before.y, entity.y) > building.y + building.h + model.width || Math.max(before.y, entity.y) < building.y - model.width) continue;
        consider(building, finite(building.elevation, this._ground({ x: building.x + building.w / 2, y: building.y + building.h / 2 })), finite(building.height, 8),null,building);
      }
      for (const object of this.game.staticObjects || []) {
        if (object.destroyed || distance(entity, object) > model.width + model.length + 130) continue;
        const angle = finite(object.angle), c = Math.cos(angle), s = Math.sin(angle);
        for (const part of object.parts || []) {
          const offset = part.offset || [0, 0, 0], half = part.half || [.3, .5, .3];
          const x = object.x + (offset[0] * c - offset[2] * s) * SCALE, y = object.y + (offset[0] * s + offset[2] * c) * SCALE;
          consider({ x: x - half[0] * SCALE, y: y - half[2] * SCALE, w: half[0] * 40, h: half[2] * 40, angle }, finite(object.elevation, this._ground(object)) + offset[1] - half[1], half[1] * 2, null, object);
        }
      }
      for (const other of this.aircraft.concat(this.game.cars || [], this.game.police || [])) {
        if (other === entity || other.visible === false || other.exploded) continue;
        if (distance(entity, other) > model.width + model.length + Math.hypot(delta.x, delta.y) + 180) continue;
        const otherModel = isAircraft(other) ? getModel(other) : roadModel(other);
        consider({ x: other.x - otherModel.length / 2, y: other.y - otherModel.width / 2, w: otherModel.length, h: otherModel.width, angle: other.angle }, finite(other.elevation), otherModel.height, other);
      }
      if (!hit) return;
      const speed = Math.hypot(entity.speed, entity.vz * SCALE);
      const travel = Math.max(1, Math.hypot(delta.x, delta.y));
      const fraction = Math.max(0, hit.fraction - bodyRadius / travel * .12);
      entity.x = before.x + delta.x * fraction; entity.y = before.y + delta.y * fraction;
      entity.speed *= -.18; entity.vx = Math.cos(entity.angle) * entity.speed; entity.vy = Math.sin(entity.angle) * entity.speed;
      if (this.time - finite(entity._collisionAt, -10) > .55) {
        entity._collisionAt = this.time;
        const amount = Math.max(0, speed - 45) * .13;
        this.damage(entity, amount);
        if (amount > 0 && entity === this.current && this.game.missionStats) this.game.missionStats.collisions++;
        if (hit.other && amount > 0) {
          if(entity===this.current)this.game._reportBaseHit?.(hit.other,hit.other,{playerCaused:true,ownerId:entity.id});
          if (isAircraft(hit.other)) this.damage(hit.other, amount * .6);
          else this.game._damageVehicle?.(hit.other, amount * .65);
        }
        if (hit.prop && amount > 0) this.game._damageProp?.(hit.prop, amount * 2, entity, entity.id === this.game.player?.vehicleId);
        if (speed > 65) {
          this.game._sound?.('crash', { x: entity.x, y: entity.y, sourceId: entity.id, intensity: clamp(speed / 700, .2, 1), material: hit.other ? 'vehicle' : 'stone' });
          if (entity === this.current && hit.other) this.game._raiseHeat?.(1, 'Aircraft collision', { position: entity, noise: 280 });
        }
      }
    }

    _routeFor(entity) {
      const field = this._field(entity), configured = field.airport.taxiRoutes;
      const route = Array.isArray(configured) ? configured.find(item => item.standId === entity.standId) : configured?.[entity.standId];
      if (route?.points?.length) return route.points.map(point => ({ ...point }));
      if (Array.isArray(route) && route.length) return route.map(point => ({ ...point }));
      const taxi = field.airport.taxiways?.[0], side = { x: -Math.sin(field.heading), y: Math.cos(field.heading) };
      const taxiCenter = taxi ? { x: taxi.x + taxi.w / 2, y: taxi.y + taxi.h / 2 } : { x: field.threshold.x - side.x * 315, y: field.threshold.y - side.y * 315 };
      const offset = (taxiCenter.x - field.threshold.x) * side.x + (taxiCenter.y - field.threshold.y) * side.y;
      const across = (entity.x - field.threshold.x) * side.x + (entity.y - field.threshold.y) * side.y;
      return [{ x: entity.x + side.x * (offset - across), y: entity.y + side.y * (offset - across) }, { x: field.threshold.x + side.x * offset, y: field.threshold.y + side.y * offset }, { ...field.threshold }];
    }

    _arrivalRouteFor(entity, destination) {
      const field = this._field(entity), configured = field.airport.arrivalTaxiRoutes;
      const route = Array.isArray(configured) ? configured.find(item => item.standId === destination.id) : configured?.[destination.id];
      if (route?.points?.length) return route.points.map(point => ({ ...point })).concat([{ ...destination }]);
      if (Array.isArray(route) && route.length) return route.map(point => ({ ...point })).concat([{ ...destination }]);
      const departure = this._routeFor({ ...entity, ...destination, standId: destination.id || entity.standId });
      // Follow the taxiway parallel to either runway orientation. The old
      // north/south-only return path would cross a horizontal base runway.
      const side = { x: -Math.sin(field.heading), y: Math.cos(field.heading) };
      const exit = { x: field.runwayEnd.x - Math.cos(field.heading) * 75, y: field.runwayEnd.y - Math.sin(field.heading) * 75 };
      const taxi = departure[Math.max(0, departure.length - 2)], offset = (taxi.x - field.threshold.x) * side.x + (taxi.y - field.threshold.y) * side.y;
      return [exit, { x: exit.x + side.x * offset, y: exit.y + side.y * offset }, ...departure.slice(0, -2).reverse(), { ...destination }];
    }

    _steer(entity, target, throttle, altitude) {
      const heading = Math.atan2(target.y - entity.y, target.x - entity.x), difference = wrap(heading - entity.angle);
      const heli = getModel(entity).class === 'helicopter';
      const command = { throttle, left: difference < -.035, right: difference > .035 };
      if (heli) command.up = distance(entity, target) > 55;
      if (Number.isFinite(altitude)) {
        command.climb = entity.elevation < altitude - 1; command.descend = entity.elevation > altitude + 1;
        command.verticalSpeed = clamp((altitude - entity.elevation) * 1.6, -getModel(entity).descentRate, getModel(entity).climbRate);
      }
      return command;
    }

    _groundTrafficClear(entity) {
      const field = this._field(entity);
      if (field.runwayReservation && field.runwayReservation !== entity.id) {
        const owner = this.aircraft.find(other => other.id === field.runwayReservation);
        if (owner && owner.visible !== false && owner.npc && ['arrival', 'landing'].includes(owner.flightPhase)) return false;
      }
      return !this.aircraft.some(other => other !== entity && this._field(other) === field && other.visible !== false && other.npc && !other.exploded && ['taxi', 'hold', 'takeoff', 'landing', 'taxi-in', 'hold-parking'].includes(other.flightPhase));
    }

    _runwayFree(entity) {
      const field = this._field(entity);
      if (['arrival', 'landing'].includes(entity.flightPhase) && !this._groundTrafficClear(entity)) return false;
      if (field.runwayReservation && field.runwayReservation !== entity.id) {
        const owner = this.aircraft.find(item => item.id === field.runwayReservation);
        if (owner && owner.visible !== false && !owner.exploded && owner.npc && ['takeoff', 'landing', 'hold', 'arrival'].includes(owner.flightPhase)) return false;
        field.runwayReservation = null;
      }
      const center = { x: field.runway.x + field.runway.w / 2, y: field.runway.y + field.runway.h / 2 };
      const runwayHeight = this._ground(center);
      return !this.aircraft.concat(this.game.cars || [], this.game.police || [], this.game.peds || [], this.game.player?.vehicleId ? [] : [this.game.player].filter(Boolean)).some(other => other !== entity && !other.transportedBy && other.visible !== false && finite(other.elevation) < runwayHeight + 12 && inBox(other, field.runway, isAircraft(other) ? getModel(other).width * .4 : 25));
    }

    _npc(entity, dt) {
      const model = getModel(entity), phase = entity.flightPhase, field = this._field(entity);
      if (entity.militaryResponse && ['boarding', 'taxi', 'hold', 'takeoff'].includes(phase) && entity.grounded && (finite(this.game.heat) < 4 || this._militaryTarget().mode !== entity.militaryTargetMode)) {
        this._releaseRunway(entity);
        if (phase === 'boarding') { this._phase(entity, 'parked'); this._finishMilitary(entity); return { throttle: 0 }; }
        entity.taxiRoute = this._routeFor(entity).slice(0, phase === 'taxi' ? finite(entity.taxiIndex) + 1 : undefined).reverse().concat([{ ...entity.home }]);
        entity.taxiIndex = 0; this._phase(entity, 'taxi-in'); return { throttle: 0 };
      }
      if (entity.militaryResponse && ['go-around', 'hold-parking'].includes(phase)) { this._releaseRunway(entity); entity.militaryReturnRoute = null; this._phase(entity, 'military-return'); return { throttle: .7, climb: true }; }
      if (entity.militaryResponse && phase.startsWith('military-')) return this._militaryDuty(entity, dt);
      if (['patrol', 'chase', 'search', 'return'].includes(phase)) return this._helicopterDuty(entity, dt);
      if (model.class === 'helicopter') return this._airTaxi(entity, dt);
      if (phase === 'parked') {
        if (entity.phaseTime > entity.departureDelay) this._phase(entity, 'boarding');
        return { throttle: 0 };
      }
      if (phase === 'boarding') {
        entity.passengers = Math.min(model.seats, Math.floor(entity.phaseTime / 1.1));
        if (entity.phaseTime >= 8 && this._groundTrafficClear(entity)) { entity.taxiRoute = this._routeFor(entity); entity.taxiIndex = 0; this._phase(entity, 'taxi'); }
        return { throttle: 0 };
      }
      if (phase === 'taxi') {
        const target = entity.taxiRoute[entity.taxiIndex];
        if (!target) { entity.speed = 0; this._phase(entity, 'hold'); return { throttle: 0 }; }
        if (distance(entity, target) < 30) entity.taxiIndex++;
        const command = this._steer(entity, target, .09);
        const error = Math.abs(wrap(Math.atan2(target.y - entity.y, target.x - entity.x) - entity.angle));
        // Tight apron turns need a taxi steering rate independent of airspeed.
        entity.angle = wrap(entity.angle + clamp(wrap(Math.atan2(target.y - entity.y, target.x - entity.x) - entity.angle), -1.3 * dt, 1.3 * dt));
        if (error > .75) command.throttle = .025;
        return command;
      }
      if (phase === 'hold') {
        entity.speed = approach(entity.speed, 0, 180, dt);
        if (this._runwayFree(entity)) {
          field.runwayReservation = entity.id; this._phase(entity, 'takeoff'); entity.lineUp = true;
        }
        return { throttle: 0 };
      }
      if (phase === 'takeoff') {
        if (entity.grounded && !this._runwayFree(entity)) {
          this._releaseRunway(entity); this._phase(entity, 'hold'); return { throttle: 0 };
        }
        if (entity.lineUp) {
          if (distance(entity, field.threshold) > 25) {
            entity.angle = Math.atan2(field.threshold.y - entity.y, field.threshold.x - entity.x);
            return { throttle: .085 };
          }
          entity.lineUp = false; entity.angle = field.heading;
        }
        if (entity.elevation > this._ground(field.threshold) + 38) { this._releaseRunway(entity); this._phase(entity, entity.militaryResponse ? 'military-intercept' : 'departure'); }
        return { throttle: .85, climb: true };
      }
      if (phase === 'departure') {
        if (entity.phaseTime > 15) { entity.visible = false; entity.speed = 0; this._phase(entity, 'turnaround'); return {}; }
        return this._steer(entity, { x: field.runwayEnd.x + Math.cos(field.heading) * 5000, y: field.runwayEnd.y + Math.sin(field.heading) * 5000 }, .72, this._ground(field.threshold) + 100);
      }
      if (phase === 'turnaround') {
        if (entity.phaseTime > 20) {
          Object.assign(entity, field.approach, { angle: field.heading, visible: true, grounded: false, speed: model.stallSpeed * 1.35, vz: 0, health: entity.maxHealth, engineHealth: 100, handlingHealth: 100 });
          this._phase(entity, 'arrival');
        }
        return {};
      }
      if (phase === 'arrival') {
        if (!this._runwayFree(entity)) { this._phase(entity, 'go-around'); this._releaseRunway(entity); return { throttle: .9, climb: true }; }
        field.runwayReservation = entity.id;
        const range = distance(entity, field.threshold), targetAltitude = this._ground(field.threshold) + clamp(range / 60, 0, 75);
        if (range < 950) this._phase(entity, 'landing');
        return this._steer(entity, field.threshold, model.stallSpeed * 1.2 / model.maxSpeed, targetAltitude);
      }
      if (phase === 'landing') {
        if (!this._runwayFree(entity)) { this._phase(entity, 'go-around'); this._releaseRunway(entity); return { throttle: .9, climb: true }; }
        const along = (field.threshold.x - entity.x) * Math.cos(field.heading) + (field.threshold.y - entity.y) * Math.sin(field.heading);
        const targetAltitude = this._ground(field.threshold) + Math.max(0, along / 60);
        const command = this._steer(entity, field.runwayEnd, entity.grounded ? 0 : model.stallSpeed * 1.12 / model.maxSpeed, targetAltitude);
        if (entity.grounded) {
          entity.speed = approach(entity.speed, 0, 135, dt);
          if (Math.abs(entity.speed) < 25) {
            this._releaseRunway(entity);
            const destination = this.parkingPosition(entity.aircraftType, entity);
            if (destination) {
              entity.taxiRoute = this._arrivalRouteFor(entity, destination);
              entity.taxiIndex = 0; entity.returningToStand = true; this._phase(entity, 'taxi-in');
            } else this._phase(entity, 'hold-parking');
          }
        }
        return command;
      }
      if (phase === 'go-around') {
        if (entity.phaseTime > 14) { entity.visible = false; this._phase(entity, 'turnaround'); }
        return { throttle: .85, climb: true };
      }
      if (phase === 'taxi-in') {
        const target = entity.taxiRoute[entity.taxiIndex];
        if (!target) { entity.speed = 0; entity.passengers = 0; entity.angle = finite(entity.home.angle); this._phase(entity, 'parked'); if (entity.militaryResponse) this._finishMilitary(entity); return { throttle: 0 }; }
        if (distance(entity, target) < 25) entity.taxiIndex++;
        entity.angle = wrap(entity.angle + clamp(wrap(Math.atan2(target.y - entity.y, target.x - entity.x) - entity.angle), -1.3 * dt, 1.3 * dt));
        return { throttle: .07 };
      }
      if (phase === 'hold-parking') {
        if (this.parkingPosition(entity.aircraftType, entity)) { this._phase(entity, 'departure'); return { throttle: .8, climb: true }; }
        return { throttle: 0 };
      }
      return { throttle: 0 };
    }

    _airTaxi(entity, dt) {
      const model = getModel(entity);
      if (!entity.routePads?.length) {
        const field = this._field(entity), localPads = field.id === 'military' ? field.helipads : (this.game.world?.landscape?.helipads || []).concat(field.helipads);
        const destination = localPads.find(pad => distance(pad, entity.home) > 300);
        if (!destination) return { throttle: 0 };
        entity.routePads = [{ ...entity.home }, { ...destination }]; entity.routeIndex = 1;
      }
      const destination = entity.routePads[finite(entity.routeIndex, 1) % entity.routePads.length];
      const base = finite(destination.elevation, this._support(destination));
      const range = distance(entity, destination), phase = entity.flightPhase;
      const cruising = Math.max(this._ground(entity) + 55, base + 55);
      if (phase === 'parked') {
        if (entity.phaseTime >= entity.departureDelay) this._phase(entity, 'boarding');
        return { throttle: 0 };
      }
      if (phase === 'boarding') {
        entity.passengers = Math.min(model.seats, Math.floor(entity.phaseTime / 1.2));
        if (entity.phaseTime > 6) this._phase(entity, 'vertical-takeoff');
        return { throttle: 0 };
      }
      if (phase === 'vertical-takeoff') {
        if (entity.altitudeAGL > 38) this._phase(entity, 'cruise');
        return { throttle: .7, climb: true, hover: true };
      }
      if (phase === 'cruise') {
        if (range < 650) this._phase(entity, 'air-approach');
        return this._steer(entity, destination, .8, cruising);
      }
      const clear = this.clearPosition(entity, { ...destination, elevation: base }, entity);
      if (!clear && phase !== 'air-hold') this._phase(entity, 'air-hold');
      if (entity.flightPhase === 'air-hold') {
        if (clear) this._phase(entity, 'air-approach');
        const radial = Math.atan2(entity.y - destination.y, entity.x - destination.x);
        return this._steer(entity, { x: destination.x + Math.cos(radial + .5) * 420, y: destination.y + Math.sin(radial + .5) * 420 }, .7, cruising);
      }
      if (phase === 'air-approach') {
        const command = this._steer(entity, destination, .65, base + Math.min(32, Math.max(10, (range - 80) / 10)));
        command.hover = true;
        if (range < 65 && Math.abs(entity.speed) < 100) this._phase(entity, 'vertical-landing');
        return command;
      }
      if (phase === 'vertical-landing') {
        const command = this._steer(entity, destination, .6, base - .05);
        command.up = range > 45; command.hover = true;
        if (entity.grounded && range < 85) {
          entity.speed = 0; entity.throttle = 0; entity.passengers = 0;
          entity.routeIndex = (finite(entity.routeIndex, 1) + 1) % entity.routePads.length;
          this._phase(entity, 'boarding'); return { throttle: 0, hover: true };
        }
        return command;
      }
      return { throttle: 0, hover: true };
    }

    _knownIncident() {
      const known = this.game._reportedLocation || this.game.police?.find(officer => officer.lastSeen && officer.alerted)?.lastSeen;
      if (known) return { x: known.x, y: known.y, elevation: finite(known.elevation, this._ground(known)) };
      // Heat itself follows witnessed trouble. Snapshot once at dispatch; no
      // further position updates happen until the helicopter really sees it.
      const target = this.current || this.game.current || this.game.player;
      return target ? { x: target.x, y: target.y, elevation: finite(target.elevation) } : null;
    }

    _militaryTarget() {
      const target = this.current || this.game.current || this.game.player;
      const mode = isAircraft(target) ? 'air' : this.game.player?.vehicleId && target !== this.game.player ? 'ground' : null;
      return { target, mode };
    }

    _setMilitaryStatus(entity, phase, seen = false) {
      const type = entity ? getModel(entity).class === 'plane' ? 'jet' : 'helicopter' : this._militaryIncident?.mode === 'air' ? 'jet' : this._militaryIncident?.mode === 'ground' ? 'helicopter' : null;
      const name = type === 'jet' ? 'Jet interceptor' : type === 'helicopter' ? 'Military helicopter' : 'Northwatch';
      this.militaryStatus = { active: Boolean(entity || this.militaryWarning), type, phase, seen,
        label: name + ': ' + ({ standby: 'standing by', warning: 'scrambling', launching: 'launching', pursuit: 'pursuing', search: 'searching last sighting', returning: 'returning to base', unavailable: 'awaiting a clear reserve' }[phase] || phase) };
    }

    _dispatchMilitary(dt) {
      const heat = finite(this.game.heat), { mode } = this._militaryTarget();
      this._militaryCooldown = Math.max(0, this._militaryCooldown - dt);
      for (const entity of this.aircraft) if (entity.militaryResponse && (entity.borrowed || entity === this.current || entity.health <= 0 || entity.exploded || !entity.npc)) this._finishMilitary(entity);
      const active = this.militaryResponse;
      if (active) {
        this.militaryWarning = 0; this._militaryHeatTime = 0;
        this._setMilitaryStatus(active, active.flightPhase === 'military-search' ? 'search' : ['military-return', 'military-land', 'arrival', 'landing', 'go-around', 'taxi-in', 'hold-parking'].includes(active.flightPhase) ? 'returning' : active.flightPhase.startsWith('military-') && active.flightPhase !== 'military-lift' ? 'pursuit' : 'launching');
        return;
      }
      if (heat < 4 || !mode || !this.airports.military) {
        this.militaryWarning = 0; this._militaryHeatTime = 0; this._militaryIncident = null;
        this._setMilitaryStatus(null, 'standby'); return;
      }
      if (this._militaryIncident && this._militaryIncident.mode !== mode) { this.militaryWarning = 0; this._militaryHeatTime = 0; this._militaryIncident = null; }
      this._militaryHeatTime += dt;
      if (this._militaryHeatTime > 5 && !this._militaryCooldown && !this.militaryWarning) {
        const incident = this._knownIncident();
        if (incident) {
          this._militaryIncident = { ...incident, mode }; this.militaryWarning = 8;
          this._toast(mode === 'air' ? 'Northwatch is scrambling a jet interceptor. Land and lose the fourth star!' : 'Northwatch is launching an armed helicopter. Find solid cover!', 'warning');
        }
      }
      if (this.militaryWarning > 0) {
        this._setMilitaryStatus(null, 'warning');
        this.militaryWarning = Math.max(0, this.militaryWarning - dt);
        if (!this.militaryWarning) {
          const entity = this._launchMilitary(this._militaryIncident);
          this._militaryCooldown = entity ? 90 : 12; this._militaryHeatTime = 0;
          this._setMilitaryStatus(entity, entity ? 'launching' : 'unavailable');
        }
      } else this._setMilitaryStatus(null, this._militaryCooldown ? 'unavailable' : 'standby');
    }

    _launchMilitary(incident) {
      const field = this.airports.military;
      if (!field || !incident || this.militaryResponse) return null;
      const type = incident.mode === 'air' ? 'fighter' : 'transportheli';
      let entity = this.aircraft.find(item => item.airportId === 'military' && item.aircraftType === type && !item.npc && !item.borrowed && item !== this.current && !item.exploded && !item.burning && item.health > item.maxHealth * .5 && item.engineHealth > 60 && item.flightPhase === 'parked');
      // Reserves appear only at a physically clear base stand, never beside the
      // target. A nearby player can see the existing fleet launch instead.
      if (!entity) {
        const position = this.parkingPosition(type, null, 'military'), target = this._militaryTarget().target;
        const reserve = this.aircraft.find(item => item.militaryReserve && item.aircraftType === type && !item.borrowed);
        if (reserve) {
          if (reserve.health > 0 && !reserve.exploded || this.time - finite(reserve.militaryRetiredAt, this.time) < 60 || target && distance(target, reserve) < 1800) return null;
          this.aircraft.splice(this.aircraft.indexOf(reserve), 1);
        }
        if (!position || target && distance(target, position) < 1800) return null;
        entity = this.spawn(type, position, { airportId: 'military', militaryReserve: true, standId: position.id });
      }
      if (!entity) return null;
      Object.assign(entity, { npc: true, militaryResponse: true, militaryUnit: true, responseRole: 'military',
        militaryRole: type === 'fighter' ? 'interceptor' : 'gunship', gunMount: type === 'fighter' ? 'forward' : 'side',
        militaryTargetMode: incident.mode, lastSeen: { x: incident.x, y: incident.y, elevation: incident.elevation },
        incident: { ...incident }, searchTime: 0, seenTime: 0, dutyTime: 0, gunWarning: 4, searchlight: type !== 'fighter', returningToStand: false, militaryReturnRoute: null });
      this._phase(entity, type === 'fighter' ? 'boarding' : 'military-lift');
      return entity;
    }

    _finishMilitary(entity) {
      entity.militaryResponse = false; entity.searchlight = false; entity.gunFiring = false;
      entity.militaryRetiredAt = this.time;
      if (!entity.borrowed && entity !== this.current && entity.health > 0) entity.npc = false;
      this._releaseRunway(entity); this._militaryCooldown = Math.max(this._militaryCooldown, 45);
    }

    _militaryClearance(entity, target, requested) {
      const model = getModel(entity), look = model.class === 'plane' ? 2400 : 1000;
      const heading = Math.atan2(target.y - entity.y, target.x - entity.x), length = Math.min(look, distance(entity, target));
      let altitude = requested;
      for (let i = 0; i <= 12; i++) {
        const point = { x: entity.x + Math.cos(heading) * length * i / 12, y: entity.y + Math.sin(heading) * length * i / 12 };
        altitude = Math.max(altitude, this._ground(point) + 30);
        for (const building of this.game.buildings || []) if (inBox(point, building, model.width * .6 + 80)) altitude = Math.max(altitude, finite(building.elevation, this._ground(point)) + finite(building.height, 8) + 22);
      }
      return altitude;
    }

    _militarySteer(entity, point, throttle, altitude) {
      return this._steer(entity, point, throttle, this._militaryClearance(entity, point, altitude));
    }

    _militaryDuty(entity, dt) {
      const model = getModel(entity), plane = model.class === 'plane', field = this._field(entity), phase = entity.flightPhase;
      entity.dutyTime = finite(entity.dutyTime) + dt;
      const { target, mode } = this._militaryTarget();
      if (finite(this.game.heat) < 4 || mode && mode !== entity.militaryTargetMode || entity.dutyTime > 180 || entity.health < entity.maxHealth * .3) {
        if (phase !== 'military-return' && phase !== 'military-land') { this._releaseRunway(entity); this._phase(entity, 'military-return'); }
      }
      if (entity.flightPhase === 'military-lift') {
        if (entity.altitudeAGL > 36) this._phase(entity, 'military-intercept');
        return { throttle: .7, climb: true, hover: true };
      }
      if (entity.flightPhase === 'military-return' || entity.flightPhase === 'military-land') {
        this._setMilitaryStatus(entity, 'returning');
        if (plane) {
          if (!entity.militaryReturnRoute) {
            const c = Math.cos(field.heading), s = Math.sin(field.heading), entry = { x: field.approach.x - c * 2200, y: field.approach.y - s * 2200 };
            entity.militaryReturnRoute = [{ x: entry.x - s * 2200, y: entry.y + c * 2200 }, entry, { ...field.approach }]; entity.militaryReturnIndex = 0;
          }
          const route = entity.militaryReturnRoute, index = entity.militaryReturnIndex, point = route[index];
          if (index < route.length - 1 && distance(entity, point) < 650) entity.militaryReturnIndex++;
          const range = distance(entity, field.approach), bearing = Math.atan2(field.threshold.y - entity.y, field.threshold.x - entity.x);
          if (entity.militaryReturnIndex === route.length - 1 && range < 950 && Math.abs(wrap(bearing - entity.angle)) < .4) { this._phase(entity, 'arrival'); return this._steer(entity, field.threshold, .32, field.approach.elevation); }
          // Fly a downwind/base/final circuit. Its turns leave enough room for
          // the real fighter's turn radius before joining the runway heading.
          return this._militarySteer(entity, route[entity.militaryReturnIndex], .38, field.approach.elevation);
        }
        const home = entity.home, range = distance(entity, home), ground = finite(home.elevation, this._ground(home));
        if (range < 500 && !this.clearPosition(entity, { ...home, elevation: ground }, entity)) {
          const parking = this.parkingPosition(entity.aircraftType, entity, 'military');
          if (parking) entity.home = { ...parking };
          const radial = Math.atan2(entity.y - home.y, entity.x - home.x);
          return this._militarySteer(entity, { x: home.x + Math.cos(radial + .65) * 420, y: home.y + Math.sin(radial + .65) * 420 }, .65, ground + 45);
        }
        const command = range > 260 ? this._militarySteer(entity, home, .7, ground + 45) : this._steer(entity, home, .6, range > 65 ? ground + 12 : ground - .05);
        command.up = range > 30; command.hover = range < 300;
        if (range < 65 && entity.grounded) { entity.speed = 0; entity.throttle = 0; entity.angle = finite(home.angle); this._phase(entity, 'parked'); this._finishMilitary(entity); }
        return command;
      }
      const visible = Boolean(mode && mode === entity.militaryTargetMode && target?.health !== 0 && !target?.exploded && this._canSee(entity, target, plane ? 4000 : 2500));
      if (visible) {
        entity.lastSeen = { x: target.x, y: target.y, elevation: finite(target.elevation) };
        entity.searchTime = 0; entity.seenTime = finite(entity.seenTime) + dt; this.game.airPoliceSeen = true;
        entity.gunWarning = Math.max(0, finite(entity.gunWarning, 4) - dt);
        if (entity.flightPhase === 'military-search') this._phase(entity, 'military-intercept');
      } else {
        entity.searchTime = finite(entity.searchTime) + dt; entity.seenTime = 0;
        if (entity.flightPhase !== 'military-search') this._phase(entity, 'military-search');
        if (entity.searchTime > 30) { this._phase(entity, 'military-return'); return { throttle: .65, climb: true }; }
      }
      this._setMilitaryStatus(entity, visible ? 'pursuit' : 'search', visible);
      const center = entity.lastSeen || entity.incident;
      if (!plane) {
        const radial = Math.atan2(entity.y - center.y, entity.x - center.x), radius = 650;
        const point = { x: center.x + Math.cos(radial + .5) * radius, y: center.y + Math.sin(radial + .5) * radius };
        const command = this._militarySteer(entity, point, .8, Math.max(this._ground(center) + 45, finite(center.elevation) + 38));
        if (visible && entity.seenTime > 4 && !entity.gunWarning && distance(entity, target) < 1250) { command.fire = true; command.aimAngle = Math.atan2(target.y - entity.y, target.x - entity.x); command.target = target; }
        return command;
      }
      if (!visible) {
        const radial = Math.atan2(entity.y - center.y, entity.x - center.x);
        return this._militarySteer(entity, { x: center.x + Math.cos(radial + .7) * 1800, y: center.y + Math.sin(radial + .7) * 1800 }, .45, Math.max(finite(center.elevation) + 35, this._ground(center) + 80));
      }
      if (entity.flightPhase === 'military-egress') {
        if (entity.phaseTime > 3 && distance(entity, target) > 1550 || entity.phaseTime > 7) this._phase(entity, 'military-intercept');
        return this._militarySteer(entity, entity.egressPoint, .72, Math.max(entity.elevation, finite(center.elevation) + 45));
      }
      const range = distance(entity, target), lead = Math.min(2.2, range / 1600);
      const point = { x: target.x + finite(target.vx) * lead, y: target.y + finite(target.vy) * lead };
      if (range < 1000 || range < 1500 && Math.abs(wrap(Math.atan2(point.y - entity.y, point.x - entity.x) - entity.angle)) > 1.2) {
        entity.egressPoint = { x: entity.x + Math.cos(entity.angle + 1) * 5000, y: entity.y + Math.sin(entity.angle + 1) * 5000 };
        this._phase(entity, 'military-egress');
        return this._militarySteer(entity, entity.egressPoint, .72, Math.max(entity.elevation + 20, finite(target.elevation) + 45));
      }
      const command = this._militarySteer(entity, point, .62, finite(target.elevation) + 22);
      if (entity.seenTime > 4 && !entity.gunWarning && range < 2400) { command.fire = true; command.target = target; }
      return command;
    }

    _dispatch(dt) {
      const heat = finite(this.game.heat);
      this._policeCooldown = Math.max(0, this._policeCooldown - dt); this._newsCooldown = Math.max(0, this._newsCooldown - dt);
      this._dispatchMilitary(dt);
      this._highHeatTime = heat >= 3 ? this._highHeatTime + dt : 0;
      this._newsHeatTime = heat >= 1 ? this._newsHeatTime + dt : 0;
      const activePolice = this.aircraft.find(entity => entity.aircraftType === 'policeheli' && entity.npc && !['parked', 'wrecked'].includes(entity.flightPhase) && !entity.exploded);
      if (heat < 3 && this.policeWarning > 0) { this.policeWarning = 0; this._dispatchLocation = null; }
      if (this._highHeatTime > 8 && !activePolice && !this._policeCooldown && !this.policeWarning && this.current?.aircraftType !== 'policeheli') {
        this.policeWarning = 6; this._dispatchLocation = this._knownIncident();
        this._toast('Air patrol inbound in 6 seconds. Break sight behind solid cover!', 'warning');
      }
      if (this.policeWarning > 0) {
        this.policeWarning = Math.max(0, this.policeWarning - dt);
        if (!this.policeWarning && this._dispatchLocation && heat >= 3) {
          this._launchDuty('policeheli', this._dispatchLocation); this._policeCooldown = 55; this._highHeatTime = 0;
        }
      }
      if (this._newsHeatTime > 14 && !this._newsCooldown && !this.aircraft.some(entity => entity.aircraftType === 'news' && entity.npc && entity.flightPhase !== 'parked')) {
        const incident = this._knownIncident();
        if (incident) this._launchDuty('news', incident);
        this._newsCooldown = 90; this._newsHeatTime = 0;
      }
    }

    _launchDuty(type, incident) {
      let entity = this.aircraft.find(item => item.aircraftType === type && item.id !== this.game.player?.vehicleId && item.health > 0 && item.flightPhase === 'parked');
      if (!entity) {
        if (this.aircraft.some(item => item.aircraftType === type && !item.exploded)) return null;
        entity = this.spawn(type, { x: incident.x + 1800, y: incident.y + 600, elevation: this._ground(incident) + 72 });
      }
      if (!entity) return null;
      entity.npc = true; entity.lastSeen = { ...incident }; entity.incident = { ...incident }; entity.searchTime = 0; entity.seenTime = 0; entity.dutyTime = 0; entity.gunWarning = 3;
      entity.searchlight = type === 'policeheli';
      // Launch from the real pad. No aircraft teleports into a player's view.
      this._phase(entity, type === 'policeheli' ? 'chase' : 'patrol');
      return entity;
    }

    _canSee(observer, target, range = 2500) {
      if (!target || distance(observer, target) > range) return false;
      const from = observer.elevation + 1.8, to = finite(target.elevation) + 1;
      if (this.game._blockedLine?.(observer, target, from, to)) return false;
      if (this._obstructionFraction({ ...observer, elevation: from }, { ...target, elevation: to }, 80) !== null) return false;
      return true;
    }

    _helicopterDuty(entity, dt) {
      entity.dutyTime = finite(entity.dutyTime) + dt;
      const police = entity.aircraftType === 'policeheli', target = this.current || this.game.current || this.game.player;
      if (entity.flightPhase === 'return') {
        const home = entity.home, range = distance(entity, home);
        const command = this._steer(entity, home, .7, range > 180 ? this._ground(home) + 45 : finite(home.elevation, this._ground(home)));
        command.up = range > 35; command.hover = range < 150;
        if (range < 65 && entity.grounded) { entity.npc = false; entity.searchlight = false; entity.speed = 0; entity.throttle = 0; this._phase(entity, 'parked'); }
        return command;
      }
      if (police) {
        if (finite(this.game.heat) <= 0 || entity.dutyTime > 150) { this._phase(entity, 'return'); return {}; }
        const visible = this._canSee(entity, target);
        if (visible) {
          entity.lastSeen = { x: target.x, y: target.y, elevation: finite(target.elevation) };
          entity.searchTime = 0; entity.seenTime = finite(entity.seenTime) + dt; this.game.airPoliceSeen = true;
          if (entity.flightPhase !== 'chase') this._phase(entity, 'chase');
        } else {
          entity.searchTime = finite(entity.searchTime) + dt; entity.seenTime = 0;
          if (entity.flightPhase !== 'search') this._phase(entity, 'search');
          if (entity.searchTime > 28) { this._phase(entity, 'return'); return {}; }
        }
        entity.gunWarning = Math.max(0, finite(entity.gunWarning, 3) - (visible ? dt : 0));
      } else if (entity.dutyTime > 55 || finite(this.game.heat) === 0 && entity.dutyTime > 20) { this._phase(entity, 'return'); return {}; }
      const center = police ? entity.lastSeen : entity.incident, radius = police ? 590 : 900;
      const radial = Math.atan2(entity.y - center.y, entity.x - center.x);
      const orbitPoint = { x: center.x + Math.cos(radial + .5) * radius, y: center.y + Math.sin(radial + .5) * radius };
      const command = this._steer(entity, orbitPoint, .8, Math.max(this._ground(center) + (police ? 38 : 65), finite(center.elevation) + 25));
      if (distance(entity, center) > radius + 450) return command;
      if (police && entity.flightPhase === 'chase' && entity.seenTime > 3 && !entity.gunWarning && this.game.heat >= 3) {
        command.fire = true; command.aimAngle = Math.atan2(target.y - entity.y, target.x - entity.x); command.target = target;
      }
      return command;
    }

    _fire(entity, aimAngle, target, aimPitch = 0) {
      if (entity.gunCooldown > 0 || entity.health <= 0 || entity.exploded || !Number.isFinite(aimAngle)) return false;
      const side = entity.angle + Math.PI / 2;
      if (Math.abs(wrap(aimAngle - side)) > .65) return false;
      if (target && (!this._canSee(entity, target) || distance(entity, target) > 1250)) return false;
      const burstTime = this.time % 2.2;
      if (burstTime > .65) return false;
      entity.gunCooldown = .14; entity.gunFiring = true;
      const offset = entity.militaryResponse ? 45 : 23, forward = entity.militaryResponse ? 6 : 0;
      const x = entity.x + Math.cos(side) * offset + Math.cos(entity.angle) * forward, y = entity.y + Math.sin(side) * offset + Math.sin(entity.angle) * forward, elevation = entity.elevation + (entity.militaryResponse ? 1.8 : 1.6);
      const travel = target ? Math.max(.04, Math.hypot(target.x - x, target.y - y) / 1400) : .8;
      const aim = target && entity.militaryResponse ? { x: target.x + finite(target.vx) * travel, y: target.y + finite(target.vy) * travel } : target;
      const shotAngle = aim ? Math.atan2(aim.y - y, aim.x - x) : aimAngle;
      const shotTravel = aim ? Math.max(.04, Math.hypot(aim.x - x, aim.y - y) / 1400) : travel;
      const targetHeight = isAircraft(target) ? getModel(target).height * .5 : roadModel(target || {}).height * .5;
      const projectile = { id: 'air-round-' + this._nextId++, x, y, elevation, height: elevation,
        vx: Math.cos(shotAngle) * 1400, vy: Math.sin(shotAngle) * 1400,
        vz: target ? (finite(target.elevation) + targetHeight - elevation) / shotTravel : Math.tan(clamp(finite(aimPitch), -.8, .8)) * 70,
        life: .95, ownerId: entity.id, npc: Boolean(entity.npc), military: Boolean(entity.militaryResponse), damage: entity.militaryResponse ? 5 : 3, radius: 2, color: '#ffc94d' };
      this.aircraftProjectiles.push(projectile);
      if (entity === this.current) this.game._raiseHeat?.(.2, 'Airborne confetti cannon', { position: entity, noise: 400 });
      this.game._sound?.('pop', { x, y, intensity: .4 });
      return true;
    }

    _fireForward(entity, target) {
      if (!target || entity.gunCooldown > 0 || entity.health <= 0 || entity.exploded || !isAircraft(target) || !this._canSee(entity, target, 2600)) return false;
      const range = distance(entity, target), travel = Math.max(.05, range / 3000);
      const aim = { x: target.x + finite(target.vx) * travel, y: target.y + finite(target.vy) * travel, elevation: finite(target.elevation) + getModel(target).height * .5 + finite(target.vz) * travel };
      const angle = Math.atan2(aim.y - entity.y, aim.x - entity.x);
      if (range < 550 || range > 2400 || Math.abs(wrap(angle - entity.angle)) > .12 || this.time % 2.5 > .7) return false;
      const x = entity.x + Math.cos(entity.angle) * 131, y = entity.y + Math.sin(entity.angle) * 131, elevation = entity.elevation + 1.7;
      const shotTravel = Math.max(.04, Math.hypot(aim.x - x, aim.y - y) / 3000);
      const shotAngle = Math.atan2(aim.y - y, aim.x - x);
      entity.gunCooldown = .12; entity.gunFiring = true;
      this.aircraftProjectiles.push({ id: 'air-round-' + this._nextId++, x, y, elevation, height: elevation,
        vx: Math.cos(shotAngle) * 3000, vy: Math.sin(shotAngle) * 3000, vz: (aim.elevation - elevation) / shotTravel,
        life: .9, ownerId: entity.id, npc: true, military: true, damage: 8, radius: 2, color: '#ffca62' });
      this.game._sound?.('pop', { x, y, intensity: .5 }); return true;
    }

    _obstructionFraction(from, to, step = 30) {
      let closest = null;
      const minX = Math.min(from.x, to.x), maxX = Math.max(from.x, to.x), minY = Math.min(from.y, to.y), maxY = Math.max(from.y, to.y);
      const consider = fraction => { if (fraction !== null && (closest === null || fraction < closest)) closest = fraction; };
      for (const building of this.game.buildings || []) {
        const radius = Math.hypot(building.w, building.h) / 2, x = building.x + building.w / 2, y = building.y + building.h / 2;
        if (x + radius < minX || x - radius > maxX || y + radius < minY || y - radius > maxY) continue;
        consider(segmentBox(from, to, building, finite(building.elevation, this._ground({ x, y })), finite(building.height, 8)));
      }
      for (const object of this.game.staticObjects || []) {
        if (object.destroyed) continue;
        const angle = finite(object.angle), c = Math.cos(angle), s = Math.sin(angle);
        for (const part of object.parts || []) {
          const offset = part.offset || [0, 0, 0], half = part.half || [.3, .5, .3];
          const x = object.x + (offset[0] * c - offset[2] * s) * SCALE, y = object.y + (offset[0] * s + offset[2] * c) * SCALE;
          const radius = Math.hypot(half[0], half[2]) * SCALE;
          if (x + radius < minX || x - radius > maxX || y + radius < minY || y - radius > maxY) continue;
          consider(segmentBox(from, to, { x: x - half[0] * SCALE, y: y - half[2] * SCALE, w: half[0] * 40, h: half[2] * 40, angle }, finite(object.elevation, this._ground(object)) + offset[1] - half[1], half[1] * 2));
        }
      }
      const count = Math.max(1, Math.ceil(distance(from, to) / step));
      for (let i = 0; i <= count; i++) {
        const fraction = i / count;
        if (closest !== null && fraction >= closest) break;
        const point = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
        if (from.elevation + (to.elevation - from.elevation) * fraction <= this._ground(point)) { consider(fraction); break; }
      }
      return closest;
    }

    _projectiles(dt) {
      for (const round of this.aircraftProjectiles) {
        const travelTime = Math.min(dt, Math.max(0, round.life)); round.life -= dt;
        const before = { x: round.x, y: round.y, elevation: round.elevation };
        round.x += round.vx * travelTime; round.y += round.vy * travelTime; round.elevation += round.vz * travelTime; round.height = round.elevation;
        let fraction = this._obstructionFraction(before, round), targetHit = null;
        if (fraction === null && this.game._blockedLine?.(before, round, before.elevation, round.elevation)) fraction = 0;
        const candidates = round.npc ? [this.current || this.game.current || this.game.player].filter(Boolean).concat(this.aircraft, this.game.cars || [], this.game.police || []) : this.aircraft.concat(this.game.cars || [], this.game.police || [], this.game.peds || []);
        const solidRay = candidates.some(target=>target.kind==='tank'||target.kind==='truck') && this.game.vehiclePhysics?.firstHit?.(
          {...before,height:before.elevation},{...round,height:round.elevation},round.ownerId);
        for (const target of new Set(candidates)) {
          if (target.id === round.ownerId || target.transportedBy || target.visible === false || target.exploded) continue;
          const road = VehicleStats && Object.hasOwn(VehicleStats.CAR_TYPES, target.kind);
          const model = isAircraft(target) ? getModel(target) : road ? roadModel(target) : { length: 24, width: 24, height: 1.9 };
          const box = { x: target.x - model.length / 2, y: target.y - model.width / 2, w: model.length, h: model.width, angle: target.angle };
          let hit;
          if(target.kind==='tank'||target.kind==='truck'&&this.game.vehiclePhysics?.get?.(target.id)) {
            if(this.game.vehiclePhysics?.get?.(target.id)) {
              // Cannon resolves the actual truck pose or articulated tank
              // solids used by contacts, including the empty gun overhang.
              const dx=round.x-before.x,dy=round.y-before.y,dz=(round.elevation-before.elevation)*SCALE,length2=dx*dx+dy*dy+dz*dz;
              hit=solidRay?.body.entity===target ? clamp(((solidRay.x-before.x)*dx+(solidRay.y-before.y)*dy+(solidRay.height-before.elevation)*SCALE*dz)/(length2||1),0,1) : null;
            } else {
              // Standalone flight simulations may omit the Cannon world.
              const hits=Physics.tankBoxes(target).map(solid=>{
                const m=solid.basis,local=p=>{const x=p.x/SCALE-solid.x,y=p.elevation-solid.y,z=p.y/SCALE-solid.z;return {x:(x*m[0]+y*m[3]+z*m[6])*SCALE,y:(x*m[2]+y*m[5]+z*m[8])*SCALE,elevation:x*m[1]+y*m[4]+z*m[7]};};
                return segmentBox(local(before),local(round),{x:-solid.hx*SCALE,y:-solid.hz*SCALE,w:solid.hx*40,h:solid.hz*40},-solid.hy,solid.hy*2);
              }).filter(value=>value!==null);
              hit=hits.length?Math.min(...hits):null;
            }
          } else hit = segmentBox(before, round, box, finite(target.elevation), model.height);
          if (hit === null || fraction !== null && hit >= fraction) continue;
          fraction = hit; targetHit = target;
        }
        if (fraction === null) continue;
        round.x = before.x + (round.x - before.x) * fraction; round.y = before.y + (round.y - before.y) * fraction;
        round.elevation = round.height = before.elevation + (round.elevation - before.elevation) * fraction;
        const victims = [], officers = [], amount = finite(round.damage, 3);
        if (targetHit) {
          if (isAircraft(targetHit)) this.damage(targetHit, amount);
          else if (targetHit === this.game.player) {
            targetHit.composure = Math.max(10, finite(targetHit.composure, 100) - amount);
            targetHit.bubble = 'OH, CRUMBS!'; targetHit.bubbleTimer = 1;
          } else if ((this.game.peds || []).includes(targetHit)) {
            if (this.game._knockDown?.(targetHit, { x: round.vx / 500, y: 2, z: round.vy / 500 })) victims.push(targetHit);
          } else {
            this.game._damageVehicle?.(targetHit, amount);
            if ((this.game.police || []).includes(targetHit)) { targetHit.distracted = 1.5; officers.push(targetHit); }
          }
        }
        round.life = 0; this.game._confetti?.(round.x, round.y, 6, round.elevation);
        if(!round.npc) {
          this.game._reportBaseAttackSegment?.(before,round,round.ownerId);
          if(targetHit)this.game._reportBaseHit?.(targetHit,round,{playerCaused:true,ownerId:round.ownerId});
        }
        if (!round.npc) this.game._raiseHeat?.(.5, 'Airborne cannon impact', { position: round, noise: 260, victims, officers });
      }
      // Keep the array identity stable for renderers and integrations.
      for (let i = this.aircraftProjectiles.length - 1; i >= 0; i--) if (this.aircraftProjectiles[i].life <= 0) this.aircraftProjectiles.splice(i, 1);
    }

  }

  const api = { AircraftSystem, AIRCRAFT_TYPES, isAircraft, getModel, boardingDistance, SCALE };
  root.MayhemAircraft = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
