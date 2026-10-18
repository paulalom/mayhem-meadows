(function (root) {
  'use strict';

  const World = root.MayhemWorld || (typeof require === 'function' ? require('./world.js') : null);
  const SIZE = World.SIZE;
  const MAX_HEAT = 4;
  const MAX_POLICE_HEAT = 3;
  // Kept as a compatibility export for old tools; routing uses RoadNetwork.
  const ROAD_CENTERS = [180, 540, 900, 1260, 1620, 1980];
  const ROAD_WIDTH = 104;
  const SIDEWALK_WIDTH = World.SIDEWALK_WIDTH;
  const BUILDING_SETBACK = ROAD_WIDTH / 2 + SIDEWALK_WIDTH;
  const DISTRICTS = World.DISTRICTS;
  const districtAt = World.districtAt;
  const VehicleStats = root.MayhemVehicleStats || (typeof require === 'function' ? require('./vehicle-stats.js') : null);
  const { CAR_TYPES, CAR_MODELS } = VehicleStats;
  const COLORS = ['#ffd15b', '#fb8097', '#67d3c8', '#a6a0fa', '#90c66b', '#6fb5eb'];
  const MILITARY_COLORS = ['#73806a', '#8c9275'];
  const GADGETS = {
    popper: { name: 'Confetti Popper', description: 'Unlimited bursts of close-up silliness.', price: 0, cooldown: 0.55 },
    hammer: { name: 'Inflatable Hammer', description: 'A short, satisfying shove. No refills needed.', price: 120, cooldown: 0.9 },
    cannon: { name: 'Party Cannon', description: 'Lob a party ball that showers a crowd in confetti.', price: 280, cooldown: 1.1 }
  };
  const POCKET_ITEMS = {
    biscuits: { name: 'Biscuits', description: 'Restore 40 composure.', price: 15, cap: 5 },
    repairTape: { name: 'Repair Tape', description: 'Restore 55 body, engine and handling health; put out a stopped car fire.', price: 35, cap: 3 },
    refill: { name: 'Party Refill', description: 'Add 6 Party Cannon shots, up to 12.', price: 30, cap: 3 }
  };
  const owns = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);
  const isMilitaryUtility = vehicle => vehicle?.militaryModel === 'utility-truck' && vehicle.kind === 'van' &&
    owns(CAR_MODELS, vehicle.modelId) && CAR_MODELS[vehicle.modelId].kind === 'van';
  const starterInventory = () => ({ equipped: 'popper', unlocked: ['popper'], pockets: { biscuits: 2, repairTape: 1, refill: 1 }, ammo: { cannon: 0 } });
  const CURSES = ['SON OF A BISCUIT!', 'HECKITY HECK!', 'FLIPPIN’ TURNIPS!', 'OH, CRUMBS!', 'YOU ABSOLUTE WAFFLE!'];
  const PROP_SOUND_MATERIALS = { fence: 'wood', bench: 'wood', lamp: 'metal', wash: 'metal', wayfinding: 'metal', fountain: 'stone', tree: 'foliage' };
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const wrapAngle = n => Math.atan2(Math.sin(n), Math.cos(n));
  const finite = (n, fallback) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  const numeric = (n, fallback, min, max) => clamp(Math.floor(finite(n, fallback)), min, max);
  const Physics = root.MayhemPhysics || (typeof require === 'function' ? require('./physics.js') : null);
  const { CHARACTER_SCALE, PERSON_HEIGHT, MUZZLE_HEIGHT, PLAYER_RADIUS, NPC_RADIUS } = Physics;
  const VehiclePhysics = root.MayhemVehiclePhysics || (typeof require === 'function' ? require('./vehicle-physics.js') : null);
  const Aircraft = root.MayhemAircraft || (typeof require === 'function' ? require('./aircraft.js') : null);
  const Trains = root.MayhemTrains || (typeof require === 'function' ? require('./trains.js') : null);
  const Aliens = root.MayhemAliens || (typeof require === 'function' ? require('./aliens.js') : null);

  // Cars keep arcade steering on the ground, with contacts matching their
  // rendered rectangular footprint rather than an undersized bounding circle.
  function orientedBox(entity, length, width) {
    const c = Math.cos(entity.angle || 0), s = Math.sin(entity.angle || 0);
    return { x: entity.x, y: entity.y, axes: [{ x: c, y: s }, { x: -s, y: c }], half: [length / 2, width / 2] };
  }

  function boxContact(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    let best = null;
    for (const axis of a.axes.concat(b.axes)) {
      const project = box => box.half.reduce((sum, half, i) => sum + half * Math.abs(axis.x * box.axes[i].x + axis.y * box.axes[i].y), 0);
      const signed = dx * axis.x + dy * axis.y;
      const depth = project(a) + project(b) - Math.abs(signed);
      if (depth <= 0.00001) return null;
      if (!best || depth < best.depth) best = { nx: axis.x * (signed < 0 ? -1 : 1), ny: axis.y * (signed < 0 ? -1 : 1), depth };
    }
    return best;
  }

  function segmentHitsRect(a, b, rect) {
    if (rect.angle) {
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2, c = Math.cos(rect.angle), s = Math.sin(rect.angle);
      const local = point => ({ x: (point.x-cx)*c + (point.y-cy)*s, y: -(point.x-cx)*s + (point.y-cy)*c });
      return segmentHitsRect(local(a),local(b),{ x: -rect.w/2, y: -rect.h/2, w: rect.w, h: rect.h });
    }
    let low = 0, high = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x - rect.x], [dx, rect.x + rect.w - a.x], [-dy, a.y - rect.y], [dy, rect.y + rect.h - a.y]]) {
      if (Math.abs(p) < 0.00001) { if (q < 0) return false; }
      else {
        const t = q / p;
        if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
        if (low > high) return false;
      }
    }
    return true;
  }

  function segmentHitsVolume(a,b,rect,fromHeight,toHeight) {
    const angle=rect.angle || 0,c=Math.cos(angle),s=Math.sin(angle),cx=rect.x+rect.w/2,cy=rect.y+rect.h/2;
    const local=point=>({x:(point.x-cx)*c+(point.y-cy)*s,y:-(point.x-cx)*s+(point.y-cy)*c});
    const p=local(a),q=local(b); let low=0,high=1;
    for(const [origin,delta,min,max] of [[p.x,q.x-p.x,-rect.w/2,rect.w/2],[p.y,q.y-p.y,-rect.h/2,rect.h/2],
      [fromHeight,toHeight-fromHeight,rect.elevation,rect.elevation+finite(rect.height,8)]]) {
      if(Math.abs(delta)<.000001) { if(origin<min || origin>max) return false; }
      else {
        let near=(min-origin)/delta,far=(max-origin)/delta;
        if(near>far) [near,far]=[far,near]; low=Math.max(low,near); high=Math.min(high,far);
        if(low>high) return false;
      }
    }
    return true;
  }

  class Game {
    constructor(options = {}) {
      this._seed = (typeof options === 'number' ? options : finite(options.seed, Date.now())) >>> 0;
      this._nextId = 1;
      this._events = [];
      this.time = 0;
      this.money = 150;
      this.score = 0;
      this.bestScore = 0;
      this.completed = 0;
      this.upgrades = { boost: 0, armor: 0 };
      this.inventory = starterInventory();
      this.garage = { cars: [] };
      this.hangar = { aircraft: [] };
      this.heat = 0;
      this.escapeTimer = 0;
      this.policeSeen = false;
      this._witnessReports = [];
      this._reportedLocation = null;
      this._policeSearching = false;
      this.graceTimer = 2;
      this.mission = null;
      this.missionStats = { elapsed: 0, collisions: 0, style: 0, overtime: false, comfort: 100 };
      this.player = { id: 'player', x: 884, y: 1080, angle: -Math.PI / 2, vehicleId: null, composure: 100, ragdollGrace: 0, stunned: 0, bubble: '', bubbleTimer: 0, elevation: 0, verticalVelocity: 0, grounded: true };
      this.ragdolls = new Physics.RagdollWorld();
      this.physics = this.ragdolls;
      this.cars = [];
      this.peds = [];
      this.police = [];
      this.buildings = [];
      this.blocks = [];
      this.staticObjects = [];
      this._environmentVersion = 0;
      this.debris = [];
      this.particles = [];
      this.projectiles = [];
      this.skidMarks = [];
      this.services = [];
      this._troubleCooldown = 0;
      this._impactCooldown = 0;
      this._actionCooldown = 0;
      this._hornCooldown = 0;
      this._styleCooldown = 0;
      this._driftTime = 0;
      this._nearMisses = new Map();
      this._makeTown();
      this.railTraffic = new Trains.TrainSystem(this);
      this.trainCars = this.railTraffic.cars;
      this.vehiclePhysics = new VehiclePhysics.VehicleWorld(this, CAR_TYPES);
      this.aviation = new Aircraft.AircraftSystem(this);
      this.aircraft = this.aviation.aircraft;
      this.aliens = new Aliens.AlienSystem(this);
    }

    get current() { return this.cars.find(car => car.id === this.player.vehicleId) || this.aircraft?.find(craft => craft.id === this.player.vehicleId) || this.player; }
    districtAt(point = this.current) { return districtAt(point); }
    _worldBounds() {
      const bounds = this.world?.bounds;
      return { minX: finite(bounds?.minX, 0), minY: finite(bounds?.minY, 0), maxX: finite(bounds?.maxX, SIZE), maxY: finite(bounds?.maxY, SIZE) };
    }
    _ground(point,y) {
      const x=typeof point==='object' ? point.x : point;
      y=typeof point==='object' ? point.y : y;
      return finite(this.world?.terrain?.surfaceHeight(x,y),0);
    }
    _base(entity) {
      return Number.isFinite(entity.elevation) ? entity.elevation : this._ground(entity.x+(entity.w || 0)/2,entity.y+(entity.h || 0)/2);
    }
    _onGround(entity) {
      const normal=this.world?.terrain?.surfaceNormalAt?.(entity.x,entity.y) || this.world?.terrain?.normalAt?.(entity.x,entity.y);
      const allowance='speed' in entity ? Math.max(.2,VehiclePhysics.height(entity)/2*(1/Math.max(.35,finite(normal?.y,1))-1)+.1) : .2;
      return Math.abs(this._base(entity)-this._ground(entity))<allowance && Math.abs(finite(entity.verticalVelocity,0))<2;
    }
    _buildingVolume(building) {
      const base=this._base(building),bottom=finite(building.foundationBottom,base);
      return {elevation:bottom,height:base+finite(building.height,8)-bottom};
    }
    _blockedLine(a,b,fromHeight=this._base(a)+MUZZLE_HEIGHT,toHeight=this._base(b)+MUZZLE_HEIGHT) {
      return this.buildings.some(building=>segmentHitsVolume(a,b,{...building,...this._buildingVolume(building)},fromHeight,toHeight));
    }
    _dry(point) {
      const terrain=this.world?.terrain;
      return !terrain || !terrain.isWater(point.x,point.y) || this._ground(point)>=finite(terrain.waterLevel,0)+.25;
    }
    get heatLevel() { return numeric(this.heat, 0, 0, MAX_HEAT); }
    get escapeGoal() { return this.heat > 0 ? 8 + this.heat * 6 : 0; }
    get maxHealth() { return 100 + this.upgrades.armor * 25; }
    get garageAvailable() {
      if(Aircraft.isAircraft(this.current)) return false;
      const garage = this.services.find(service => service.id === 'garage');
      return Boolean(garage && distance(this.current, garage) < 115 &&
        (!this.player.vehicleId || Math.abs(this.current.speed) <= 45 && this.current.upright !== false && this._onGround(this.current)) &&
        (this.player.vehicleId || this._onGround(this.player)) && !this.ragdolls.get(this.player.id));
    }

    _random() { this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0; return this._seed / 4294967296; }
    _pick(items) { return items[Math.floor(this._random() * items.length)]; }
    _toast(text, kind = 'info') { this._events.push({ type: 'toast', text, kind }); }
    _sound(name, details = {}) { this._events.push({ type: 'sound', name, details }); }
    drainEvents() { return this._events.splice(0); }

    _makeTown() {
      this.world = World.createWorld(); this.network = this.world.network; this.terrain=this.world.terrain;
      this.roads = this.world.roads; this.nodes = this.world.nodes;
      this.blocks = this.world.blocks; this.areas = this.world.areas;
      this.buildings = this.world.buildings; this.staticObjects = this.world.staticObjects;
      this.services = this.world.services; this.pedPaths = this.world.pedPaths;
      Object.assign(this.player, this.world.start.player);
      this.player.elevation=this._ground(this.player);
      const starter = this.world.start.car;
      this._addCar(starter.x, starter.y, starter.angle, starter.kind, starter.color);
      for (const spawn of this.world.vehicleSpawns) {
        if (distance(spawn, starter) < 5) continue;
        const candidate = { ...spawn, elevation: this._ground(spawn) };
        if (!this._vehicleFree(candidate) || this._vehicles().some(other => this._vehicleContact(candidate, other))) continue;
        const car = this._addCar(spawn.x, spawn.y, spawn.angle, spawn.kind, spawn.color, spawn.traffic);
        car.roadId = spawn.roadId;
        if(spawn.militaryModel){car.militaryModel=spawn.militaryModel;car.modelId=spawn.modelId||car.modelId;car.baseId='military';}
        if (car.traffic) car.route = this._wanderRoute(car);
      }
      this._makePedestrians();
      const patrolPoint = this.nodes.find(node => distance(node, this.player) > 500 && this._dry(node) && this._vehicleFree({ ...node, kind: 'compact', angle: 0 })) || this._safeRoadPosition(this.player);
      this.police.push({ id: 'police-' + this._nextId++, x: patrolPoint.x, y: patrolPoint.y, angle: patrolPoint.angle || 0,
        ...this._vehicleState('compact'),elevation:this._ground(patrolPoint),verticalVelocity:0,grounded:true,speed: 0, route: [], routeTimer: 0, lastSeen: { x: this.player.x, y: this.player.y } });
    }

    _makePedestrians() {
      const used = {};
      for (const path of this.pedPaths) {
        const paths = this.pedPaths.filter(candidate => candidate.district===path.district).length;
        const indexInDistrict = used[path.district] || 0; used[path.district] = indexInDistrict + 1;
        const budget = finite(DISTRICTS[path.district]?.pedCount,paths);
        const count = Math.floor((indexInDistrict+1)*budget/paths)-Math.floor(indexInDistrict*budget/paths);
        for (let n = 0; n < count; n++) {
          let index = Math.min(path.points.length - 2, Math.floor((n + 0.4) / count * (path.points.length - 1)));
          let point = null;
          for (let trial = 0; trial < path.points.length; trial++) {
            const candidate = path.points[(index + trial) % path.points.length];
            if (this._dry(candidate) && this._personFree(candidate.x, candidate.y, NPC_RADIUS) && this.peds.every(ped => distance(ped, candidate) > NPC_RADIUS * 3)) {
              point = candidate; index = (index + trial) % path.points.length; break;
            }
          }
          if (!point) continue;
          const next = path.points[Math.min(index + 1,path.points.length - 1)], id = this.peds.length;
          this.peds.push({ id: 'ped-' + id, x: point.x, y: point.y, angle: Math.atan2(next.y-point.y,next.x-point.x),
            elevation:this._ground(point),verticalVelocity:0,grounded:true,
            stunned: 0, bubble: '', bubbleTimer: 0, homeX: point.x, homeY: point.y, district: path.district,
            pathId: path.id, pathIndex: index + 1 < path.points.length ? index + 1 : index - 1,
            pathDirection: index + 1 < path.points.length ? 1 : -1, color: COLORS[id % COLORS.length], pace: 15 + this._random() * 12 });
        }
      }
    }

    _addCar(x, y, angle, kind, color, traffic = false) {
      const state = this._vehicleState(kind);
      const models = Object.values(CAR_MODELS).filter(model => model.kind === kind);
      // Stable variety without consuming the town's seeded random sequence.
      if (models.length) state.modelId = models[(this._nextId - 1) % models.length].id;
      const car = { id: 'car-' + this._nextId++, x, y, angle, speed: 0, ...state, color, kind, traffic, vx: 0, vy: 0, borrowed: false, route: [], elevation: this._ground(x,y), verticalVelocity: 0, grounded: true, upright: true };
      this.cars.push(car);
      return car;
    }

    _vehicleState(kind) {
      return { kind, modelId: VehicleStats.getModel({ kind }).id, maxHealth: this.maxHealth,
        health: this.maxHealth, engineHealth: 100, handlingHealth: 100, burning: false, fireTime: 0, exploded: false };
    }

    vehicleStats(vehicle = this.current) { return Aircraft.isAircraft(vehicle) ? Aircraft.getModel(vehicle) : VehicleStats.performance(vehicle); }

    _isFree(x, y, radius = PLAYER_RADIUS, elevation=this._ground(x,y)) {
      const bounds = this._worldBounds();
      if (x < bounds.minX + radius || y < bounds.minY + radius || x > bounds.maxX - radius || y > bounds.maxY - radius) return false;
      return !this.buildings.some(b => { const volume=this._buildingVolume(b); return this._heightOverlap({elevation},volume,PERSON_HEIGHT,volume.height) && this._circlePart({ x, y }, radius, { box: this._buildingBox(b) }); }) &&
        !this._staticParts().some(part => part.bottom<elevation+PERSON_HEIGHT-.025 && part.top>elevation+.025 && this._circlePart({ x, y }, radius, part));
    }

    _vehicles() { return this.cars.concat(this.police); }
    _solidVehicles() { return this._vehicles().concat((this.aircraft || []).filter(craft=>craft.visible!==false),this.railTraffic?.colliders || []); }

    _vehicleBox(entity) {
      const type = entity.railModel || (Aircraft.isAircraft(entity) ? Aircraft.getModel(entity) : CAR_TYPES[entity.kind] || CAR_TYPES.compact);
      return orientedBox(entity, type.length, type.width);
    }

    _buildingBox(building) { return orientedBox({ x: building.x + building.w/2, y: building.y + building.h/2, angle: building.angle || 0 },building.w,building.h); }

    _buildingBounds(building) {
      const box = this._buildingBox(building), ex = Math.abs(box.axes[0].x)*box.half[0] + Math.abs(box.axes[1].x)*box.half[1];
      const ey = Math.abs(box.axes[0].y)*box.half[0] + Math.abs(box.axes[1].y)*box.half[1];
      return { x: box.x-ex, y: box.y-ey, w: ex*2, h: ey*2 };
    }

    _vehicleContact(a, b) {
      if (!this._heightOverlap(a, b, VehiclePhysics.height(a), VehiclePhysics.height(b))) return null;
      const ta = CAR_TYPES[a.kind] || CAR_TYPES.compact, tb = CAR_TYPES[b.kind] || CAR_TYPES.compact;
      const reach = (Math.hypot(ta.length, ta.width) + Math.hypot(tb.length, tb.width)) / 2;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > reach * reach) return null;
      return boxContact(this._vehicleBox(a), this._vehicleBox(b));
    }

    _vehicleFree(entity) {
      const box = this._vehicleBox(entity);
      const ex = Math.abs(box.axes[0].x) * box.half[0] + Math.abs(box.axes[1].x) * box.half[1];
      const ey = Math.abs(box.axes[0].y) * box.half[0] + Math.abs(box.axes[1].y) * box.half[1];
      const bounds = this._worldBounds();
      return entity.x >= bounds.minX + ex && entity.x <= bounds.maxX - ex && entity.y >= bounds.minY + ey && entity.y <= bounds.maxY - ey &&
        !this.buildings.some(b => { const volume=this._buildingVolume(b); return this._heightOverlap(entity,volume,VehiclePhysics.height(entity),volume.height) && boxContact(box,this._buildingBox(b)); }) &&
        !this._staticParts().some(part => part.bottom<this._base(entity)+VehiclePhysics.height(entity)-.025 && part.top>this._base(entity)+.025 && boxContact(box, part.box));
    }

    _heightOverlap(a, b, ah = PERSON_HEIGHT, bh = PERSON_HEIGHT) {
      const ay = this._base(a), by = this._base(b);
      return ay < by + bh - 0.025 && ay + ah > by + 0.025;
    }

    _staticParts() {
      if (this._streetParts && this._streetObjects === this.staticObjects && this._streetVersion === this._environmentVersion && this._streetTerrain===this.world?.terrain) return this._streetParts;
      this._streetObjects = this.staticObjects;
      this._streetTerrain=this.world?.terrain;
      this._streetVersion = this._environmentVersion;
      return this._streetParts = this.staticObjects.filter(object => !object.destroyed).flatMap(object => object.parts.map(part => {
        const angle = object.angle || 0, c = Math.cos(angle), s = Math.sin(angle);
        const x = object.x + (part.offset[0] * c - part.offset[2] * s) * 20;
        const y = object.y + (part.offset[0] * s + part.offset[2] * c) * 20;
        return { box: orientedBox({ x, y, angle }, part.half[0] * 40, part.half[2] * 40),
          bottom: this._base(object)+part.offset[1] - part.half[1], top: this._base(object)+part.offset[1] + part.half[1], cylinder: part.shape === 'cylinder' };
      }));
    }

    _circlePart(entity, radius, part) {
      const box = part.box, dx = entity.x - box.x, dy = entity.y - box.y;
      const reach = box.half[0] + box.half[1] + radius;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) return null;
      let u = dx * box.axes[0].x + dy * box.axes[0].y, v = dx * box.axes[1].x + dy * box.axes[1].y;
      if (part.cylinder) {
        const d = Math.hypot(u, v), depth = radius + box.half[0] - d;
        if (depth <= 0) return null;
        return { nx: d > 0.001 ? dx / d : 1, ny: d > 0.001 ? dy / d : 0, depth };
      }
      const nearestU = clamp(u, -box.half[0], box.half[0]), nearestV = clamp(v, -box.half[1], box.half[1]);
      let rx = u - nearestU, ry = v - nearestV, d = Math.hypot(rx, ry), depth = radius - d;
      if (depth <= 0) return null;
      if (d < 0.001) {
        if (box.half[0] - Math.abs(u) < box.half[1] - Math.abs(v)) { rx = u < 0 ? -1 : 1; ry = 0; depth = box.half[0] - Math.abs(u) + radius; }
        else { rx = 0; ry = v < 0 ? -1 : 1; depth = box.half[1] - Math.abs(v) + radius; }
        d = 1;
      }
      return { nx: (rx * box.axes[0].x + ry * box.axes[1].x) / d, ny: (rx * box.axes[0].y + ry * box.axes[1].y) / d, depth };
    }

    _personVehicleContact(person, vehicle, radius = person === this.player ? PLAYER_RADIUS : NPC_RADIUS) {
      const type = vehicle.railModel || (Aircraft.isAircraft(vehicle) ? Aircraft.getModel(vehicle) : CAR_TYPES[vehicle.kind] || CAR_TYPES.compact);
      const reach = Math.hypot(type.length, type.width) / 2 + radius;
      if ((person.x - vehicle.x) ** 2 + (person.y - vehicle.y) ** 2 > reach * reach) return null;
      const entry = this.vehiclePhysics && this.vehiclePhysics.bodies.get(vehicle.id);
      return VehiclePhysics.personContact(person, entry && entry.snapshot.angle !== vehicle.angle ? { ...vehicle, orientation: null } : vehicle, radius, type);
    }

    _standingPeople() {
      const people = this.player.vehicleId ? this.peds : [this.player].concat(this.peds);
      return people.filter(person => !this.ragdolls.get(person.id));
    }

    _personFree(x, y, radius = PLAYER_RADIUS, ignore = null) {
      const point = { x, y, elevation:this._ground(x,y) };
      return this._isFree(x, y, radius) && !this._solidVehicles().some(car => car !== ignore && this._personVehicleContact(point, car, radius));
    }

    _resolvePerson(entity, radius) {
      let collision = false;
      const vehicles = this._solidVehicles(), people = this._standingPeople();
      for (let pass = 0; pass < 4; pass++) {
        let changed = this._moveCircleBuildings(entity, 0, 0, radius);
        collision = changed || collision;
        for (const vehicle of vehicles) {
          const hit = this._personVehicleContact(entity, vehicle, radius);
          if (!hit) continue;
          if (hit.vertical) {
            entity.elevation = Math.max(this._ground(entity), this._base(entity) + hit.up * hit.depth / 20);
            if (entity.verticalVelocity * hit.up < 0) entity.verticalVelocity = 0;
            if (hit.up > 0) entity.grounded = true;
            changed = collision = true; continue;
          }
          entity.x += hit.nx * (hit.depth + 0.001); entity.y += hit.ny * (hit.depth + 0.001); changed = collision = true;
        }
        for (const other of people) {
          if (other === entity) continue;
          const otherRadius = other === this.player ? PLAYER_RADIUS : NPC_RADIUS;
          const dx = entity.x - other.x, dy = entity.y - other.y, reach = radius + otherRadius;
          if (dx * dx + dy * dy >= reach * reach || !this._heightOverlap(entity, other)) continue;
          const d = Math.hypot(dx, dy), depth = reach - d;
          if (depth <= 0) continue;
          const nx = d > 0.001 ? dx / d : Math.cos(entity.angle + Math.PI / 2), ny = d > 0.001 ? dy / d : Math.sin(entity.angle + Math.PI / 2);
          entity.x += nx * (depth + 0.001); entity.y += ny * (depth + 0.001); changed = collision = true;
        }
        if (!changed) break;
      }
      if (collision) this._moveCircleBuildings(entity, 0, 0, radius);
      return collision;
    }

    _move(entity, dx, dy, radius) {
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 3));
      let collision = false;
      for (let i = 0; i < steps; i++) {
        collision = this._moveCircleBuildings(entity, dx / steps, dy / steps, radius) || collision;
        collision = this._resolvePerson(entity, radius) || collision;
      }
      return collision;
    }

    _resolveVehicle(entity) {
      let collided = false, vehicle = false;
      for (let pass = 0; pass < 6; pass++) {
        let changed = false;
        const box = this._vehicleBox(entity);
        const ex = Math.abs(box.axes[0].x) * box.half[0] + Math.abs(box.axes[1].x) * box.half[1];
        const ey = Math.abs(box.axes[0].y) * box.half[0] + Math.abs(box.axes[1].y) * box.half[1];
        const bounds = this._worldBounds(), x = clamp(entity.x, bounds.minX + ex, bounds.maxX - ex), y = clamp(entity.y, bounds.minY + ey, bounds.maxY - ey);
        if (x !== entity.x || y !== entity.y) { entity.x = x; entity.y = y; changed = collided = true; }
        for (const b of this.buildings) {
          const volume=this._buildingVolume(b);
          if(!this._heightOverlap(entity,volume,VehiclePhysics.height(entity),volume.height)) continue;
          const bounds = this._buildingBounds(b);
          if (entity.x + ex <= bounds.x || entity.x - ex >= bounds.x + bounds.w || entity.y + ey <= bounds.y || entity.y - ey >= bounds.y + bounds.h) continue;
          const rect = this._buildingBox(b);
          const hit = boxContact(this._vehicleBox(entity), rect);
          if (!hit) continue;
          entity.x += hit.nx * (hit.depth + 0.001); entity.y += hit.ny * (hit.depth + 0.001); changed = collided = true;
        }
        for (const other of this._vehicles()) {
          if (other === entity) continue;
          const hit = this._vehicleContact(entity, other);
          if (!hit) continue;
          entity.x += hit.nx * (hit.depth + 0.001); entity.y += hit.ny * (hit.depth + 0.001);
          if (other.traffic) other.speed = Math.max(0, other.speed * 0.45);
          changed = collided = vehicle = true;
        }
        if (!changed) break;
      }
      return { collided, vehicle };
    }

    _vehiclePeople(entity, velocityX, velocityY) {
      const speed = Math.hypot(velocityX, velocityY, finite(entity.verticalVelocity, 0) * 20);
      for (const person of this._standingPeople()) {
        const hit = this._personVehicleContact(person, entity);
        if (!hit) continue;
        if (!hit.vertical) { person.x += hit.nx * (hit.depth + 0.002); person.y += hit.ny * (hit.depth + 0.002); }
        this._moveCircleBuildings(person, 0, 0, person === this.player ? PLAYER_RADIUS : NPC_RADIUS);
        if (speed > 35 && !(person.ragdollGrace > 0) && (person !== this.player || this.graceTimer <= 0)) {
          const kick = clamp(speed / 20 * 0.58 + 1.2, 2.5, 11);
          this._knockDown(person, { x: velocityX / speed * kick, y: clamp(2.1 + speed / 200, 2.1, 4.5), z: velocityY / speed * kick });
          entity.speed *= 0.90;
          if (entity.id === this.player.vehicleId) this._raiseHeat(1, 'Reckless driving', { position: person, noise: 120, victims: [person] });
        }
      }
    }

    _moveVehicle(entity, dx, dy, velocityX, velocityY) {
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 3));
      let collided = false, vehicle = false;
      for (let i = 0; i < steps; i++) {
        entity.x += dx / steps; entity.y += dy / steps;
        const hit = this._resolveVehicle(entity); collided = hit.collided || collided; vehicle = hit.vehicle || vehicle;
        this._vehiclePeople(entity, velocityX, velocityY);
        if (hit.collided) break;
      }
      return { collided, vehicle };
    }

    _moveCircleBuildings(entity, dx, dy, radius) {
      const oldX = entity.x, oldY = entity.y;
      const bounds = this._worldBounds();
      entity.x = clamp(entity.x + dx, bounds.minX + radius, bounds.maxX - radius);
      entity.y = clamp(entity.y + dy, bounds.minY + radius, bounds.maxY - radius);
      let collision = entity.x !== oldX + dx || entity.y !== oldY + dy;
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (const b of this.buildings) {
          // Reject distant lots before allocating rotated boxes or volumes.
          // Summed half-extents include every corner at every yaw.
          const bx=b.x+b.w/2,by=b.y+b.h/2,reach=(b.w+b.h)/2+radius;
          if(Math.abs(entity.x-bx)>reach||Math.abs(entity.y-by)>reach)continue;
          const volume=this._buildingVolume(b);
          if (!this._heightOverlap(entity,volume,PERSON_HEIGHT,volume.height)) continue;
          const bounds = this._buildingBounds(b);
          if (entity.x + radius <= bounds.x || entity.x - radius >= bounds.x + bounds.w || entity.y + radius <= bounds.y || entity.y - radius >= bounds.y + bounds.h) continue;
          const hit = this._circlePart(entity,radius,{ box: this._buildingBox(b) });
          if (hit) { entity.x += hit.nx * (hit.depth + 0.002); entity.y += hit.ny * (hit.depth + 0.002); changed = collision = true; }
        }
        for (const part of this._staticParts()) {
          if (this._base(entity) >= part.top - 0.025 || this._base(entity) + PERSON_HEIGHT <= part.bottom + 0.025) continue;
          const hit = this._circlePart(entity, radius, part);
          if (hit) { entity.x += hit.nx * (hit.depth + 0.002); entity.y += hit.ny * (hit.depth + 0.002); changed = collision = true; }
        }
        if (!changed) break;
      }
      return collision;
    }

    _roadPosition(point) { return this.network.nearestRoad(point); }

    _safeRoadPosition(point, radius = 18, ignore = null) {
      const road = this._roadPosition(point);
      const free = candidate => {
        if(!this._dry(candidate)) return false;
        candidate.elevation=this._ground(candidate);
        if (ignore) {
          const vehicle = { ...ignore, ...candidate, orientation: null, upright: true };
          return this._vehicleFree(vehicle) && !this._vehicles().some(other => other !== ignore && this._vehicleContact(vehicle, other));
        }
        return this._personFree(candidate.x,candidate.y,radius);
      };
      for (const arc of [0,60,-60,120,-120,200,-200,320,-320]) for (const lane of [0,18,-18]) {
        const candidate = this.network.pointOnRoad(road.roadId,road.s + arc,lane);
        if (free(candidate)) return candidate;
      }
      for (const node of this.nodes.slice().sort((a,b) => distance(a,point)-distance(b,point))) {
        const projection = this._roadPosition(node);
        for (const offset of [0,70,-70,140,-140]) {
          const candidate = this.network.pointOnRoad(projection.roadId,projection.s+offset,0);
          if (free(candidate)) return candidate;
        }
      }
      return { x: road.x, y: road.y, angle: road.angle, elevation:this._ground(road) };
    }

    _nearestNode(point) { return this.nodes.reduce((a,b) => distance(a,point) < distance(b,point) ? a : b); }

    _roadRoute(from,to,laneOffset = 0) { return this.network.route(from,to,laneOffset); }

    _wanderRoute(car) {
      const connected = this.nodes.filter(node => this.network.adjacency.get(node.id).length > 1);
      let options = connected.filter(node => distance(node,car)>180 && distance(node,car)<1600 && node.id!==car.wanderGoal);
      if (!options.length) options = connected.filter(node => node.id!==car.wanderGoal);
      // A random shortest route can start with an unnecessary U-turn. Choose
      // a destination in the current direction when the graph allows it.
      // Calm patrols obey the same lanes as residents. Wanted pursuit uses
      // _roadRoute without a lane offset, plus its close direct approach.
      const offset = 18, start = Math.floor(this._random()*options.length);
      let fallback;
      for (let n=0;n<options.length;n++) {
        const goal = options[(start+n)%options.length], route = this._roadRoute(car,goal,offset);
        const forward = route.find(point => distance(car,point)>55) || route.at(-1);
        const error = forward ? Math.abs(wrapAngle(Math.atan2(forward.y-car.y,forward.x-car.x)-finite(car.angle,0))) : Math.PI;
        if (!fallback || error<fallback.error) fallback={goal,route,error};
        if (error<1.1) { car.wanderGoal=goal.id; return route; }
      }
      car.wanderGoal=fallback.goal.id; return fallback.route;
    }

    _advanceRoute(entity, route, radius = 14) {
      while (route.length > 1) {
        const target = route[0], next = route[1], beyond = (entity.x-target.x)*(next.x-target.x)+(entity.y-target.y)*(next.y-target.y)>0;
        if (distance(entity,target) < radius || beyond && distance(entity,target)<48) route.shift(); else break;
      }
      return route[0];
    }

    _routeTarget(entity, route, lookAhead = 60) {
      if (route.length<2) return route[0];
      let best=null;
      // Project only onto the upcoming samples; distant crossings must not
      // skip a loop, junction or neighborhood on the selected graph route.
      for (let i=0;i<Math.min(route.length-1,8);i++) {
        const a=route[i],b=route[i+1],dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
        const t=length2 ? clamp(((entity.x-a.x)*dx+(entity.y-a.y)*dy)/length2,0,1) : 1;
        const point={x:a.x+dx*t,y:a.y+dy*t}, d=distance(entity,point);
        if (!best || d<best.distance) best={index:i,t,point,distance:d};
      }
      if (best.distance>80) return route[0];
      if (best.index>0) route.splice(0,best.index);
      if (best.t>.98 && route.length>1) { route.shift(); best.point=route[0]; }
      let point=best.point, remaining=lookAhead;
      for (let i=1;i<route.length;i++) {
        const next=route[i], span=distance(point,next);
        if (span>=remaining && span>0) return {x:point.x+(next.x-point.x)*remaining/span,y:point.y+(next.y-point.y)*remaining/span};
        remaining-=span; point=next;
      }
      return route.at(-1);
    }

    _confetti(x, y, count = 22, height) {
      for (let i = 0; i < count && this.particles.length < 360; i++) {
        const angle = this._random() * Math.PI * 2, speed = 30 + this._random() * 150, life = 0.5 + this._random() * 0.8;
        const particle = { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color: this._pick(COLORS), size: 3 + this._random() * 4 };
        particle.height=finite(height,this._ground(x,y)+.5);
        this.particles.push(particle);
      }
    }

    _propPoints(object, origin, pitch) {
      const angle = object.angle || 0, c = Math.cos(angle), s = Math.sin(angle);
      return object.parts.map(part => {
        const cx = object.x + (part.offset[0] * c - part.offset[2] * s) * 20;
        const cy = object.y + (part.offset[0] * s + part.offset[2] * c) * 20;
        const dx = origin.x - cx, dy = origin.y - cy;
        const u = clamp(dx * c + dy * s, -part.half[0] * 20, part.half[0] * 20);
        const v = clamp(-dx * s + dy * c, -part.half[2] * 20, part.half[2] * 20);
        const x = cx + u * c - v * s, y = cy + u * s + v * c;
        const aimHeight = origin.height + (Number.isFinite(pitch) ? Math.tan(pitch) * Math.hypot(x - origin.x, y - origin.y) / 20 : 0);
        const height = clamp(aimHeight, this._base(object) + part.offset[1] - part.half[1], this._base(object) + part.offset[1] + part.half[1]);
        return { x, y, height };
      });
    }

    _propVisible(origin, point, object) {
      const hit = this.vehiclePhysics.firstHit(origin, point, origin.ignoreVehicleId, origin.ignoreProps);
      return !hit || hit.source === object;
    }

    _damageProp(object, amount, origin, playerCaused = true) {
      if (!object || object.destroyed || object.destructible === false || object.kind === 'garage' ||
        !this.staticObjects.includes(object) || !Number.isFinite(amount) || amount <= 0) return false;
      const maxHealth = finite(object.maxHealth, World.PROP_HEALTH?.[object.kind] || 45);
      object.maxHealth = maxHealth;
      object.health = Math.max(0, finite(object.health, maxHealth) - amount);
      if (object.health > 0) return true;
      object.destroyed = true; object.destroyedAt = this.time;
      this._environmentVersion++;
      // Debris is temporary scenery, with a fixed budget and no solid contacts.
      const colors = { tree: '#a88462', fence: '#e7ddbd', lamp: '#536d74', bench: '#cf9771', fountain: '#eee7d3', wash: '#89d7d1', wayfinding: '#687d74' };
      const angle = object.angle || 0, c = Math.cos(angle), s = Math.sin(angle);
      const parts = object.parts.concat(object.kind === 'tree' ? [{ offset: [0, 2.3 * (object.scale || 1), 0], half: [.8, .8, .8], color: '#80bf8e' }] : []);
      for (const part of parts) for (let i = 0; i < 3; i++) {
        const spread = this._random() * Math.PI * 2, speed = 25 + this._random() * 60;
        const life = 3 + this._random() * 1.5;
        const away = origin ? Math.atan2(object.y - origin.y, object.x - origin.x) : spread;
        this.debris.push({ x: object.x + (part.offset[0] * c - part.offset[2] * s) * 20,
          y: object.y + (part.offset[0] * s + part.offset[2] * c) * 20, elevation: this._base(object) + part.offset[1],
          vx: Math.cos(spread) * speed + Math.cos(away) * 35, vy: Math.sin(spread) * speed + Math.sin(away) * 35,
          verticalVelocity: 2 + this._random() * 3, angle: spread, spin: (this._random() - .5) * 8,
          size: part.half.map(half => clamp(half * (0.6 + this._random() * .5), .08, .65)), color: part.color || colors[object.kind] || '#b8a1e0', life, maxLife: life });
      }
      this.debris = this.debris.slice(-120);
      this._confetti(object.x, object.y, 12);
      this._sound('crash', { x: object.x, y: object.y, sourceId: object.id, destroyed: true, intensity: clamp(amount / maxHealth, .25, 1), material: PROP_SOUND_MATERIALS[object.kind] || 'stone' });
      this.vehiclePhysics.sync();
      if (playerCaused) this._raiseHeat(1, 'Scenery smashed', { position: object, noise: 180 });
      return true;
    }

    _damagePropsNear(origin, radius, amount, playerCaused = true) {
      // A burst can start inside the prop it hit. That source must not shield
      // its neighbours, and all visibility is resolved before removing bodies.
      const ignoreProps = new Set(this.staticObjects.filter(object => !object.destroyed && object.destructible !== false && object.kind !== 'garage' &&
        this._propPoints(object, origin).some(point => Math.hypot(point.x - origin.x, point.y - origin.y, (point.height - origin.height) * 20) < .001)));
      origin = { ...origin, ignoreProps };
      const targets = [];
      let hit = false;
      for (const object of this.staticObjects) {
        if (object.destroyed || object.destructible === false || object.kind === 'garage') continue;
        const point = this._propPoints(object, origin).find(point =>
          Math.hypot(point.x - origin.x, point.y - origin.y, (point.height - origin.height) * 20) < radius && this._propVisible(origin, point, object));
        if (point) targets.push(object);
      }
      for (const object of targets) hit = this._damageProp(object, amount, origin, playerCaused) || hit;
      return hit;
    }

    _strikeProps(angle, pitch, reach, amount, spread) {
      const origin = { x: this.player.x, y: this.player.y, height: this.player.elevation + MUZZLE_HEIGHT };
      let hit = false;
      for (const object of this.staticObjects) {
        if (object.destroyed || object.destructible === false || object.kind === 'garage') continue;
        const point = this._propPoints(object, origin, pitch).find(point => {
          const dx = point.x - origin.x, dy = point.y - origin.y, range = Math.hypot(dx, dy);
          const forward = dx * Math.cos(angle) + dy * Math.sin(angle);
          const height = origin.height + Math.tan(pitch) * range / 20;
          return Math.hypot(range, (point.height - origin.height) * 20) < reach && (range < 1 || forward / range > spread) &&
            Math.abs(height - point.height) < .55 && this._propVisible(origin, point, object);
        });
        if (point) hit = this._damageProp(object, amount, origin) || hit;
      }
      return hit;
    }

    _propExplosions() {
      for (const car of this._solidVehicles()) {
        if (!car.exploded || !Number.isFinite(car.explosionTime) || car._sceneryBlastAt === car.explosionTime) continue;
        car._sceneryBlastAt = car.explosionTime;
        this._damagePropsNear({ x: car.x, y: car.y, height: finite(car.elevation, 0) + .7, ignoreVehicleId: car.id }, 160, 140,
          car.id === this.player.vehicleId || car.borrowed === true);
      }
    }

    _activePolice(cop) { return cop.health > 0 && !cop.burning && !cop.exploded; }

    _incidentRange(observer, position) {
      return Math.hypot(distance(observer, position), (this._base(observer) + MUZZLE_HEIGHT - position.height) * 20);
    }

    _seesIncident(observer, position, range) {
      return this._incidentRange(observer, position) < range && !this._incidentBlocked(observer, position);
    }

    _incidentBlocked(observer, position) {
      const fromHeight = this._base(observer) + MUZZLE_HEIGHT;
      if (this._blockedLine(observer, position, fromHeight, position.height)) return true;
      const terrain = this.world?.terrain;
      if (!terrain) return false;
      const steps = Math.ceil(distance(observer, position) / 10);
      for (let step = 1; step < steps; step++) {
        const t = step / steps, height = fromHeight + (position.height - fromHeight) * t;
        const ground = (terrain.heightAt || terrain.surfaceHeight).call(terrain, observer.x + (position.x - observer.x) * t, observer.y + (position.y - observer.y) * t);
        if (ground > height + .15) return true;
      }
      return false;
    }

    _hearsIncident(observer, position, noise) {
      const range = this._incidentRange(observer, position);
      return range < noise && range < noise * (this._incidentBlocked(observer, position) ? .4 : 1);
    }

    _raiseHeat(amount = 1, reason = 'Mischief', incident = {}) {
      const source = incident.position || this.current;
      const position = { x: source.x, y: source.y, elevation: this._base(source), height: finite(source.height, this._base(source) + MUZZLE_HEIGHT) };
      const officers = incident.officers || [];
      const observed = this.police.some(cop => this._activePolice(cop) && (officers.includes(cop) ||
        (!(cop.distracted > 0) && this._seesIncident(cop, position, 400)) ||
        this._hearsIncident(cop, position, incident.noise || 0)));
      if (observed) { this._applyReportedHeat(amount, reason + ' · police noticed!', position); return true; }

      // Victims can call after a tumble. Other residents must actually see it.
      const victims = incident.victims || [];
      const reporter = this.peds.find(ped => victims.includes(ped)) || this.peds.find(ped =>
        !(ped.stunned > 0) && !this.ragdolls.get(ped.id) && this._seesIncident(ped, position, 200));
      if (!reporter || this._troubleCooldown > 0 || this._witnessReports.length) return false;
      reporter.bubble = 'HELP! CALLING POLICE...'; reporter.bubbleTimer = 2;
      this._witnessReports.push({ reporter, position, amount, reason, remaining: 2 });
      return true;
    }

    _updateWitnessReports(dt) {
      const reports = this._witnessReports;
      this._witnessReports = [];
      for (const report of reports) {
        report.remaining -= dt;
        if (report.remaining > .000001) {
          report.reporter.bubble = 'HELP! CALLING POLICE...'; report.reporter.bubbleTimer = report.remaining;
          this._witnessReports.push(report); continue;
        }
        report.reporter.bubble = 'HELP! POLICE CALLED!'; report.reporter.bubbleTimer = 2;
        this._applyReportedHeat(report.amount, report.reason + ' · a resident called for help!', report.position);
      }
    }

    _clearHeat() {
      this.heat = 0; this.escapeTimer = 0; this.policeSeen = false; this.airPoliceSeen = false; this._policeSearching = false;
      this._reportedLocation = null;
      for (const { reporter } of this._witnessReports) if (reporter.bubble === 'HELP! CALLING POLICE...') {
        reporter.bubble = ''; reporter.bubbleTimer = 0;
      }
      this._witnessReports = [];
    }

    _applyReportedHeat(amount, reason, position) {
      this.escapeTimer = 0;
      this._reportedLocation = { x: position.x, y: position.y };
      this.police.forEach(cop => { cop.lastSeen = { ...this._reportedLocation }; cop.routeTimer = 0; });
      if (this._troubleCooldown > 0) return;
      this._policeSearching = false;
      const before = this.heat;
      this.heat = clamp(this.heat + amount, 0, MAX_HEAT);
      this._troubleCooldown = 3;
      if (this.heat !== before) { this._toast(reason, 'warning'); this._sound('heat', { level: this.heat, reason }); }
    }

    interact() {
      if (this.ragdolls.get(this.player.id)) return false;
      if (this.player.parachuting) { this._toast('Land your parachute before boarding a ride.'); return false; }
      if (Aircraft.isAircraft(this.current)) return this.aviation.interact();
      if (!this.player.vehicleId && this.aviation.enterNearest()) return true;
      if (this.player.vehicleId && this.current.burning) return this._exitCar(this.current, true);
      if (!this.player.vehicleId && !this._onGround(this.player)) { this._toast('Land before hopping in or out.'); return false; }
      if (this.player.vehicleId) {
        const car = this.current;
        if (car.upright === false || !this._onGround(car)) { this._toast('Your ride needs its wheels on the road. Press R to recover.'); return false; }
        if (Math.abs(car.speed) > 45) { this._toast('Slow down before hopping out.'); return false; }
        const wash = this.services.find(s => s.id === 'wash' && distance(s, car) < 85);
        if (wash && (this.heat > 0 || this._witnessReports.length || VehicleStats.isDamaged(car))) return this._useService(wash);
        return this._exitCar(car);
      }
      const nearby = this.cars.filter(car => car.health > 0 && !car.burning && !car.exploded && distance(car, this.player) < 75 && Math.abs(car.speed) < 110 && this._onGround(car) && car.upright !== false).sort((a, b) => distance(a, this.player) - distance(b, this.player));
      if (nearby.length) {
        const car = nearby[0];
        this.player.vehicleId = car.id;
        car.traffic = false;
        car.speed = car.vx = car.vy = 0;
        this.player.x = car.x; this.player.y = car.y; this.player.elevation=car.elevation; this.player.grounded=true;
        if (!car.borrowed) { car.borrowed = true; this._raiseHeat(1, 'Borrowed a ride', { position: car }); }
        this._toast('Nice wheels. Hold Shift for boost; Space for handbrake.'); this._sound('enter', { x: car.x, y: car.y, kind: car.kind });
        return true;
      }
      const service = this.services.find(s => distance(s, this.player) < 100);
      if (service) return this._useService(service);
      this._toast('Get closer to a car, garage, or car wash.');
      return false;
    }

    _exitCar(car, forced = false) {
      const offsets = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
      for (const offset of offsets) {
        const x = car.x + Math.cos(car.angle + offset) * 40, y = car.y + Math.sin(car.angle + offset) * 40;
        if (this._personFree(x, y, PLAYER_RADIUS)) {
          this.player.vehicleId = null; this.player.x = x; this.player.y = y; this.player.angle = car.angle;
          this.player.elevation = this._ground(x,y); this.player.verticalVelocity = 0; this.player.grounded = true;
          car.speed = car.vx = car.vy = 0;
          this._sound('exit', { x: car.x, y: car.y, kind: car.kind }); return true;
        }
      }
      if (forced) {
        const position = this._safeRoadPosition(car, PLAYER_RADIUS); this.player.vehicleId = null; this.player.x = position.x; this.player.y = position.y;
        this.player.elevation = this._ground(position); this.player.verticalVelocity = 0; this.player.grounded = true;
        this._sound('exit', { x: car.x, y: car.y, kind: car.kind });
        return true;
      }
      this._toast('A little more room to hop out, please.'); return false;
    }

    _useService(service) {
      if(Aircraft.isAircraft(this.current)) { this._toast('Aircraft are serviced at the airport hangar.'); return false; }
      if (service.id === 'garage') { this._toast('Sprinkle Garage: press G for your car collection, or I for toys and pocket supplies.'); return true; }
      if (this.heat === 0 && !this._witnessReports.length && (!this.player.vehicleId || !VehicleStats.isDamaged(this.current))) { this._toast('Already sparkling clean!'); return false; }
      if (this.money < 75) { this._toast('The wash costs $75. Finish a gig for cash.', 'warning'); return false; }
      this.money -= 75; this._clearHeat(); this.player.composure = 100;
      if (this.player.vehicleId) VehicleStats.repair(this.current, this.maxHealth);
      this._confetti(this.current.x, this.current.y, 36); this._toast('Squeaky clean: heat cleared and car repaired!', 'success'); this._sound('wash', { x: service.x, y: service.y });
      return true;
    }

    action(angle = this.player.angle, options) {
      if (this.player.vehicleId || this._actionCooldown > 0 || this.ragdolls.get(this.player.id)) return false;
      angle = finite(angle, this.player.angle); this.player.angle = angle;
      // Pitch is optional for older arcade callers. Heights are world metres;
      // planar positions are simulation units (20 units per metre).
      const aimed = Boolean(options && Number.isFinite(options.pitch));
      const pitch = aimed ? clamp(options.pitch, -1.35, 1.35) : 0;
      const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
      this.player.aimPitch = pitch;
      const aimHeight = range => this.player.elevation + MUZZLE_HEIGHT + Math.tan(pitch) * range / 20;
      const inAimHeight = person => {
        if (!aimed) return Math.abs(this._base(person)-this.player.elevation)<PERSON_HEIGHT+.35*CHARACTER_SCALE;
        const dx = person.x - this.player.x, dy = person.y - this.player.y;
        const forward = dx * Math.cos(angle) + dy * Math.sin(angle);
        const height = aimHeight(Math.hypot(dx, dy));
        return forward >= 0 && height >= this._base(person) + 0.1 * CHARACTER_SCALE && height <= this._base(person) + PERSON_HEIGHT + 0.35 * CHARACTER_SCALE &&
          !this._blockedLine(this.player,person,this.player.elevation+MUZZLE_HEIGHT,height);
      };
      const equipped = this.inventory.equipped;
      if (equipped === 'cannon' && this.inventory.ammo.cannon <= 0) {
        this._toast('Party Cannon is empty. Use a Party Refill from your pockets.');
        this._sound('empty', { x: this.player.x, y: this.player.y }); return false;
      }
      this._actionCooldown = GADGETS[equipped].cooldown;
      if (equipped === 'cannon') {
        this.inventory.ammo.cannon--;
        const life = 360 / 560;
        const projectile = { id: 'party-' + this._nextId++, x: this.player.x + Math.cos(angle) * 25 * cosPitch, y: this.player.y + Math.sin(angle) * 25 * cosPitch, angle, height: this.player.elevation + MUZZLE_HEIGHT, baseHeight: this.player.elevation, life, maxLife: life };
        if (aimed) Object.assign(projectile, { aimed: true, startHeight: Math.max(this._ground(projectile)+.15, this.player.elevation + MUZZLE_HEIGHT + sinPitch * 1.25), horizontalSpeed: 560 * cosPitch, verticalSpeed: 28 * sinPitch });
        if (aimed) projectile.height = projectile.startHeight;
        this.projectiles.push(projectile);
        this._confetti(this.player.x, this.player.y, 8, this.player.elevation + MUZZLE_HEIGHT); this._sound('cannon', { x: this.player.x, y: this.player.y });
        return true;
      }
      if (equipped === 'hammer') {
        const reach = 62, forwardX = Math.cos(angle), forwardY = Math.sin(angle);
        this._confetti(this.player.x + forwardX * 35 * cosPitch, this.player.y + forwardY * 35 * cosPitch, 18, this.player.elevation + MUZZLE_HEIGHT + sinPitch * 1.75); this._sound('hammer', { x: this.player.x, y: this.player.y });
        let hit = this._strikeProps(angle, pitch, reach, 45, .5);
        const victims = [], officers = [];
        const inReach = person => {
          const dx = person.x - this.player.x, dy = person.y - this.player.y, range = Math.hypot(dx, dy);
          return range < reach && inAimHeight(person) && (range < 1 || (dx * forwardX + dy * forwardY) / range > 0.5) &&
            !this._blockedLine(this.player,person,this.player.elevation+MUZZLE_HEIGHT,this._base(person)+MUZZLE_HEIGHT);
        };
        for (const ped of this.peds) if (ped.stunned <= 0 && inReach(ped)) {
          if (this._knockDown(ped, { x: forwardX * 5.8, y: 3.2, z: forwardY * 5.8 })) { victims.push(ped); hit = true; }
        }
        for (const cop of this.police) if (this._activePolice(cop) && inReach(cop)) { officers.push(cop); cop.distracted = 2.3; this._confetti(cop.x, cop.y, 25); hit = true; }
        if (hit) this._raiseHeat(1, 'Inflatable nuisance', { noise: 100, victims, officers });
        return true;
      }
      const pop = { x: this.player.x + Math.cos(angle) * 44 * cosPitch, y: this.player.y + Math.sin(angle) * 44 * cosPitch };
      this._confetti(pop.x, pop.y, 25, this.player.elevation + MUZZLE_HEIGHT + sinPitch * 2.2); this._sound('pop', { x: pop.x, y: pop.y });
      let hit = this._strikeProps(angle, pitch, 100, 10, .65);
      const victims = [], officers = [];
      for (const ped of this.peds) if (ped.stunned <= 0 && !this.ragdolls.get(ped.id) && inAimHeight(ped) && distance(ped, pop) < 60 && this._startle(ped, angle)) { victims.push(ped); hit = true; }
      for (const cop of this.police) if (this._activePolice(cop) && inAimHeight(cop) && distance(cop, pop) < 65) { officers.push(cop); cop.distracted = 1.8; hit = true; this._confetti(cop.x, cop.y, 20); }
      if (hit) this._raiseHeat(1, 'Confetti disturbance', { noise: 140, victims, officers });
      return true;
    }

    _burstParty(projectile) {
      this._confetti(projectile.x, projectile.y, 85, projectile.aimed ? projectile.height : undefined); this._sound('party', { x: projectile.x, y: projectile.y });
      this._damagePropsNear({ x: projectile.x, y: projectile.y, height: finite(projectile.height,this._ground(projectile)+MUZZLE_HEIGHT) }, 85, 110);
      if (projectile.aimed && projectile.height > this._ground(projectile)+2.6) return;
      let hit = false;
      const victims = [], officers = [];
      for (const ped of this.peds) if (ped.stunned <= 0 && distance(ped, projectile) < 85 && Math.abs(projectile.height-this._base(ped))<2.6 &&
        !this._blockedLine(projectile,ped,projectile.height,this._base(ped)+MUZZLE_HEIGHT)) {
        const angle = distance(ped, projectile) > 1 ? Math.atan2(ped.y - projectile.y, ped.x - projectile.x) : projectile.angle;
        if (this._knockDown(ped, { x: Math.cos(angle) * 4.8, y: 3.8, z: Math.sin(angle) * 4.8 })) { victims.push(ped); hit = true; }
      }
      for (const cop of this.police) if (this._activePolice(cop) && distance(cop, projectile) < 90 && Math.abs(projectile.height-this._base(cop))<2.6 &&
        !this._blockedLine(projectile, cop, projectile.height, this._base(cop) + MUZZLE_HEIGHT)) { officers.push(cop); cop.distracted = 3; this._confetti(cop.x, cop.y, 25); hit = true; }
      if (hit) this._raiseHeat(1, 'Party Cannon commotion', { position: projectile, noise: 300, victims, officers });
    }

    _projectiles(dt) {
      const remaining = [];
      for (const projectile of this.projectiles) {
        const stepCount = Math.max(1, Math.ceil(Math.min(dt, projectile.life) * 560 / 8));
        const step = Math.min(dt, projectile.life) / stepCount;
        let burst = false;
        for (let i = 0; i < stepCount && !burst; i++) {
          const before = { x: projectile.x, y: projectile.y, height: projectile.height };
          const horizontalSpeed = projectile.aimed ? projectile.horizontalSpeed : 560;
          projectile.x += Math.cos(projectile.angle) * horizontalSpeed * step;
          projectile.y += Math.sin(projectile.angle) * horizontalSpeed * step;
          projectile.life = Math.max(0, projectile.life - step);
          const elapsed = projectile.maxLife - projectile.life;
          projectile.height = projectile.aimed ? projectile.startHeight + projectile.verticalSpeed * elapsed - 2 * elapsed * elapsed : finite(projectile.baseHeight, 0) + MUZZLE_HEIGHT + Math.sin(Math.PI * (1 - projectile.life / projectile.maxLife)) * 1.1;
          const atHeight = (bottom,top) => Math.min(before.height, projectile.height)<=top && Math.max(before.height, projectile.height)>=bottom;
          const walls = this.buildings.some(b => segmentHitsVolume(before,projectile,{x:b.x-3,y:b.y-3,w:b.w+6,h:b.h+6,angle:b.angle || 0,...this._buildingVolume(b)},before.height,projectile.height));
          const vehicleHit = this.vehiclePhysics.firstHit(before,projectile);
          const vehicles = Boolean(vehicleHit);
          if(!walls && Aircraft.isAircraft(vehicleHit?.body?.entity)) this.aviation.damage(vehicleHit.body.entity,35);
          const people = this.peds.some(ped => atHeight(this._base(ped)+.1,this._base(ped)+PERSON_HEIGHT+.35*CHARACTER_SCALE) && ped.stunned <= 0 && distance(ped, projectile) < 16 * CHARACTER_SCALE);
          const surface=this._ground(projectile),ground=projectile.height<=surface+.12;
          if (ground) projectile.height = surface+.12;
          const bounds = this._worldBounds();
          burst = walls || vehicles || people || ground || projectile.life <= 0.000001 || projectile.x < bounds.minX || projectile.y < bounds.minY || projectile.x > bounds.maxX || projectile.y > bounds.maxY;
        }
        if (burst) this._burstParty(projectile); else remaining.push(projectile);
      }
      this.projectiles = remaining;
    }

    horn() {
      if (!this.player.vehicleId) { this._toast('The parade needs a car. Borrow one and honk!'); return false; }
      if (this._hornCooldown > 0) return false;
      const car = this.current;
      this._hornCooldown = 0.55; this._sound('horn', { x: car.x, y: car.y, kind: car.kind });
      this.peds.filter(p => distance(p, car) < 100 && p.stunned <= 0).forEach(p => { p.bubble = this._pick(['TOOT TOOT!', 'NICE HORN!', 'OH, CRUMBS!']); p.bubbleTimer = 2; });
      if (this.mission && this.mission.type === 'party') {
        const target = this.mission.targets[this.mission.targetIndex];
        if (distance(car, target) < 95 && Math.abs(car.speed) < 65 && Math.abs(this._base(car)-this._base(target))<3) {
          this._confetti(target.x, target.y, 65); this._raiseHeat(1, 'Loud street party', { position: car, noise: 220 }); this._advanceMission(); return true;
        }
        if (distance(car, target) < 130) this._toast('Slow down, then honk inside the party ring.');
      }
      return true;
    }

    _knockDown(person, impulse) {
      if (this.ragdolls.get(person.id) || person.ragdollGrace > 0) return false;
      const body = this.ragdolls.trigger(person, impulse,{terrain:this.world?.terrain});
      if (!body) return false;
      person.stunned = 3.8; person.bubble = this._pick(CURSES); person.bubbleTimer = 3;
      this._confetti(person.x, person.y, 32); this._sound('flop', { x: person.x, y: person.y, intensity: clamp(Math.hypot(impulse.x || 0, impulse.y || 0, impulse.z || 0) / 9, .25, 1) });
      if (person !== this.player) this._sound('resident', { x: person.x, y: person.y, text: person.bubble, id: person.id });
      if (person === this.player) this._toast(person.bubble + ' Getting back up…');
      return true;
    }

    _startle(ped, angle = this.player.angle) {
      return this._knockDown(ped, { x: Math.cos(angle) * 3.5, y: 2.5, z: Math.sin(angle) * 3.5 });
    }

    flop() {
      if (this.player.vehicleId || this.player.parachuting || this.ragdolls.get(this.player.id) || this.player.ragdollGrace > 0) return false;
      return this._knockDown(this.player, { x: Math.cos(this.player.angle) * 2.2, y: 2.2, z: Math.sin(this.player.angle) * 2.2 });
    }

    recover() {
      this.ragdolls.clear(this.player.id);
      this.player.parachuting = false;
      this.player.stunned = 0; this.player.ragdollGrace = 1.4;
      if (Aircraft.isAircraft(this.current)) {
        if (!this.aviation.recover(this.current)) return false;
        const craft = this.current;
        Object.assign(this.player, { x: craft.x, y: craft.y, elevation: craft.elevation, angle: craft.angle, verticalVelocity: 0, grounded: true });
        this.graceTimer = 2; this.score = Math.max(0, this.score - 20);
        this._toast('Aircraft recovered to a clear stand. −20 style; damage is preserved.');
        return true;
      }
      const entity = this.current, p = this._safeRoadPosition(entity, this.player.vehicleId ? 18 : PLAYER_RADIUS, this.player.vehicleId ? entity : null);
      entity.x = p.x; entity.y = p.y; entity.elevation=this._ground(p);
      entity.waterTimer = 0; entity._submerged = false;
      if (this.player.vehicleId && Number.isFinite(p.angle)) entity.angle = p.angle;
      if (this.player.vehicleId) this.vehiclePhysics.reset(entity);
      this.player.x = p.x; this.player.y = p.y; this.player.composure = Math.max(60, this.player.composure);
      this.player.elevation = entity.elevation; this.player.verticalVelocity = 0; this.player.grounded = true;
      this.graceTimer = 2; this.score = Math.max(0, this.score - 20);
      this._toast('Unstuck! Back on the road. −20 style; your cash is safe.'); this._confetti(p.x, p.y, 22);
      return true;
    }

    _caught() {
      this.ragdolls.clear(this.player.id);
      this.player.stunned = 0; this.player.ragdollGrace = 1.4;
      const car = this.player.vehicleId ? this.current : null;
      if (car) {
        car.speed = car.vx = car.vy = 0;
        if (Aircraft.isAircraft(car)) { car.throttle=0;car.npc=false;car.phase=car.flightPhase=car.grounded?'parked':'abandoned';this.player.vehicleId=null; }
        else this._exitCar(car, true);
      }
      this.player.parachuting = false;
      const start=this.world.start.player;
      this.player.vehicleId = null; this.player.x = start.x; this.player.y = start.y; this.player.composure = 100;
      this.player.elevation = this._ground(start); this.player.verticalVelocity = 0; this.player.grounded = true;
      this.player.waterTimer = 0; this.player._submerged = false;
      this.money = Math.max(0, this.money - 50); this._clearHeat(); this.graceTimer = 3;
      this._toast('BUSTED-ISH! $50 cleanup fee. Back to the fun—your gig is still active.', 'warning'); this._sound('busted'); this._confetti(start.x,start.y,45);
    }

    acceptMission(type) {
      if (this.mission) { this._toast('Finish or abandon your current gig first.'); return false; }
      const variation = this.completed % 2;
      const anchors = this.world.missionAnchors, copyTargets = points => points.map(point => ({ x: point.x, y: point.y, elevation:this._ground(point) }));
      const recipes = {
        delivery: { title: 'Emergency Disco', description: 'Collect the disco ball, then deliver it to the dance hall.', stage: 'pickup', targets: copyTargets(variation ? anchors.deliveryAlt : anchors.delivery), totalTime: 100, reward: 140 },
        dash: { title: 'Lawn Enforcement Slalom', description: 'Drive through six gates across town and the suburbs. Late finish? You still get base pay.', stage: 'checkpoints', targets: copyTargets(anchors.dash), totalTime: 170, reward: 180 },
        party: { title: 'Operation Un-Boring', description: 'Drive to each party ring, slow down, and press H to honk.', stage: 'parties', targets: copyTargets(variation ? anchors.partyAlt : anchors.party), totalTime: 150, reward: 200 }
      };
      Object.assign(recipes, this._airMissionRecipes());
      const recipe = recipes[type];
      if (!recipe) { this._toast('Choose a gig from dispatch.'); return false; }
      this.mission = { type, ...recipe, targetIndex: 0, timeLeft: recipe.totalTime };
      this.missionStats = { elapsed: 0, collisions: 0, style: 0, overtime: false, comfort: 100 };
      this._toast(recipe.title + ': ' + recipe.description); this._sound('accept'); return true;
    }

    startMission(type) { return this.acceptMission(type); }

    _airMissionRecipes() {
      const airport = this.world?.landscape?.airport;
      if (!airport) return {};
      const pads = (airport.helipads || []).concat(this.world.landscape.helipads || []);
      const first = pads.find(pad => /airport/.test(pad.id)) || pads[0] || { x: 10550, y: 3600 };
      const marina = pads.find(pad => /marina/.test(pad.id)) || { x: 3000, y: 4900 };
      const downtown = pads.find(pad => /downtown/.test(pad.id)) || { x: 6300, y: 4400 };
      const point = (pad, name) => ({ x: pad.x, y: pad.y, elevation: finite(pad.elevation, this._ground(pad)), name });
      const air = (x,y,height,name) => ({ x,y,elevation:this._ground(x,y)+height,name,aerial:true });
      const home = point(first, 'Airport helipad'), coast = point(marina, 'Marina helipad'), roof = point(downtown, 'Downtown helipad');
      return {
        airtaxi: { title: 'Meadows Air Taxi', description: 'Land a helicopter at the airport, then carry passengers to the marina. Hold still for boarding.', stage: 'boarding', aircraftJob: true, landingJob: true, targets: [home,coast], totalTime: 180, reward: 220 },
        aircargo: { title: 'Express Party Supplies', description: 'Pick up cargo at the airport helipad, then land on the downtown pad.', stage: 'loading', aircraftJob: true, landingJob: true, targets: [home,roof], totalTime: 180, reward: 250 },
        sightseeing: { title: 'The Scenic Route', description: 'Fly through the coastal and ridge markers, then return to the airport helipad.', stage: 'sightseeing', aircraftJob: true, targets: [air(3900,5200,25,'Coast'),air(1800,3000,35,'Old Town'),air(3200,1500,40,'Ridge'),home], totalTime: 240, reward: 240 },
        airrace: { title: 'Cloud Nine Circuit', description: 'Take any aircraft through the elevated rings. Match their altitude.', stage: 'air race', aircraftJob: true, targets: [air(10100,2400,28,'Departure'),air(7800,2200,40,'Northside'),air(4800,3100,32,'Town'),air(6800,5500,30,'River'),air(10000,4000,25,'Airport')], totalTime: 180, reward: 280 }
      };
    }

    bailOut() {
      if (!Aircraft.isAircraft(this.current)) return false;
      return this.aviation.bailOut();
    }

    _parachuteStep(dt,input) {
      const p = this.player;
      const forward = Number(Boolean(input.up))-Number(Boolean(input.down));
      const side = Number(Boolean(input.right))-Number(Boolean(input.left));
      const heading = finite(input.moveAngle,p.angle);
      const dx = (Math.cos(heading)*forward+Math.cos(heading+Math.PI/2)*side)*100*dt;
      const dy = (Math.sin(heading)*forward+Math.sin(heading+Math.PI/2)*side)*100*dt;
      const bounds=this.aviation.bounds;
      const next={x:clamp(p.x+dx,bounds.minX+PLAYER_RADIUS,bounds.maxX-PLAYER_RADIUS),y:clamp(p.y+dy,bounds.minY+PLAYER_RADIUS,bounds.maxY-PLAYER_RADIUS)};
      if(!this._blockedLine(p,next,p.elevation+.5,p.elevation+.5)) {p.x=next.x;p.y=next.y;}
      p.verticalVelocity = Math.max(-4,finite(p.verticalVelocity,0)-8*dt);
      const previous = p.elevation;
      p.elevation += p.verticalVelocity*dt;
      const floor=this.vehiclePhysics.support(p.x,p.y,previous+.1);
      if(p.elevation<=floor+.02) {
        p.elevation=floor; p.parachuting=false; p.grounded=true; p.verticalVelocity=0;
        const groundBounds = this._worldBounds();
        if(p.x<groundBounds.minX+PLAYER_RADIUS || p.y<groundBounds.minY+PLAYER_RADIUS || p.x>groundBounds.maxX-PLAYER_RADIUS || p.y>groundBounds.maxY-PLAYER_RADIUS) { this.recover(); return; }
        this._sound('land',{x:p.x,y:p.y,intensity:.3}); this._toast('Touchdown! E to find another ride.');
      } else p.grounded=false;
    }

    abandonMission() {
      if (!this.mission) return false;
      this.mission = null; this._toast('Gig abandoned. Pick another whenever you like.'); return true;
    }

    _advanceMission() {
      const mission = this.mission;
      if (!mission) return;
      mission.targetIndex++;
      this._sound('checkpoint');
      if (mission.targetIndex >= mission.targets.length) {
        const timeBonus = Math.floor(50 * Math.max(0, mission.timeLeft) / mission.totalTime);
        const cleanBonus = this.missionStats.collisions < 2 ? 20 : 0;
        const styleBonus = Math.min(30, Math.floor(this.missionStats.style / 10));
        const comfortBonus = mission.type==='airtaxi' ? Math.round(clamp(finite(this.missionStats.comfort,100),0,100)*.3) : 0;
        const pay = mission.reward + timeBonus + cleanBonus + styleBonus + comfortBonus;
        this.money = Math.min(999999, this.money + pay); this.completed++; this._addScore(100 + timeBonus);
        this._confetti(this.current.x, this.current.y, 90); this._toast('Gig complete! +$' + pay + ' (' + mission.reward + ' base + ' + (pay - mission.reward) + ' bonus).', 'success'); this._sound('complete');
        this.mission = null;
      } else {
        if (mission.type === 'delivery') mission.stage = 'dropoff';
        if (mission.type === 'airtaxi') mission.stage = 'passengers aboard';
        if (mission.type === 'aircargo') mission.stage = 'cargo aboard';
        this._toast(mission.type === 'delivery' ? 'Disco ball collected! Get it to the dance hall.' : 'Nice! Next stop: ' + (mission.targetIndex + 1) + ' of ' + mission.targets.length + '.', 'success');
      }
    }

    _requireGarage() {
      if (this.garageAvailable) return true;
      this._toast('Visit Sprinkle Garage and stop to shop or manage your collection.');
      return false;
    }

    equipGadget(id) {
      if (!owns(GADGETS, id) || !this.inventory.unlocked.includes(id) || this.ragdolls.get(this.player.id)) return false;
      if (this.inventory.equipped !== id) this._sound('equip', { gadget: id });
      this.inventory.equipped = id;
      return true;
    }

    purchaseGadget(id) {
      if (!owns(GADGETS, id) || !this._requireGarage()) return false;
      if (this.inventory.unlocked.includes(id)) { this._toast('You already own the ' + GADGETS[id].name + '.'); return false; }
      const gadget = GADGETS[id];
      if (this.money < gadget.price) { this._toast('The ' + gadget.name + ' costs $' + gadget.price + '.', 'warning'); return false; }
      this.money -= gadget.price; this.inventory.unlocked.push(id); this.equipGadget(id);
      if (id === 'cannon') this.inventory.ammo.cannon = 6;
      this._toast(gadget.name + ' unlocked! Hold Tab to choose your toy.', 'success'); this._sound('purchase');
      return true;
    }

    purchasePocket(id) {
      if (!owns(POCKET_ITEMS, id) || !this._requireGarage()) return false;
      const item = POCKET_ITEMS[id];
      if (this.inventory.pockets[id] >= item.cap) { this._toast('Your pockets are full of ' + item.name + '.'); return false; }
      if (this.money < item.price) { this._toast(item.name + ' costs $' + item.price + '.', 'warning'); return false; }
      this.money -= item.price; this.inventory.pockets[id]++;
      this._toast(item.name + ' tucked into your pockets.', 'success'); this._sound('purchase'); return true;
    }

    usePocket(id) {
      if (!owns(POCKET_ITEMS, id) || this.ragdolls.get(this.player.id)) return false;
      if (this.inventory.pockets[id] <= 0) { this._toast('No ' + POCKET_ITEMS[id].name + ' left. Restock at Sprinkle Garage.'); return false; }
      if (id === 'biscuits') {
        if (this.player.composure >= 100) { this._toast('Already feeling composed. Save that biscuit for later.'); return false; }
        this.player.composure = Math.min(100, this.player.composure + 40);
      } else if (id === 'repairTape') {
        if (!this.player.vehicleId) { this._toast('Hop in a damaged car before using Repair Tape.'); return false; }
        if (Math.abs(this.current.speed) > 45 || (Aircraft.isAircraft(this.current) ? !this.current.grounded : !this._onGround(this.current)) || this.current.upright===false) { this._toast('Stop and land your ride before applying Repair Tape.'); return false; }
        if (!VehicleStats.isDamaged(this.current)) { this._toast('This ride needs no tape.'); return false; }
        VehicleStats.repair(this.current, Aircraft.isAircraft(this.current) ? finite(this.current.maxHealth,100) : this.maxHealth, 55);
        this._syncGarage();
        this._syncHangar();
      } else if (id === 'refill') {
        if (!this.inventory.unlocked.includes('cannon')) { this._toast('Unlock the Party Cannon before using a refill.'); return false; }
        if (this.inventory.ammo.cannon >= 12) { this._toast('Party Cannon is already fully stocked.'); return false; }
        this.inventory.ammo.cannon = Math.min(12, this.inventory.ammo.cannon + 6);
      }
      this.inventory.pockets[id]--;
      this._toast(POCKET_ITEMS[id].name + ' used. Lovely stuff.', 'success');
      this._sound(id === 'biscuits' ? 'biscuit' : id === 'repairTape' ? 'tape' : 'refill', { x: this.current.x, y: this.current.y }); return true;
    }

    _syncGarage() {
      for (const record of this.garage.cars) {
        const deployed = this.cars.find(car => car.garageId === record.id);
        if (deployed) {
          record.health = clamp(finite(deployed.health, 0), 0, this.maxHealth); record.color = deployed.color;
          record.modelId = VehicleStats.getModel(deployed).id;
          if (isMilitaryUtility(deployed)) record.militaryModel = 'utility-truck';
          else delete record.militaryModel;
          record.engineHealth = clamp(finite(deployed.engineHealth, 100), 0, 100);
          record.handlingHealth = clamp(finite(deployed.handlingHealth, 100), 0, 100);
          record.burning = Boolean(deployed.burning); record.fireTime = clamp(finite(deployed.fireTime, 0), 0, 8);
          record.exploded = Boolean(deployed.exploded);
        }
        record.maxHealth = this.maxHealth;
      }
    }

    get hangarAvailable() {
      const entity=this.current;
      const airportId=this.aviation?.airportAt(entity),landscape=this.world?.landscape;
      const airport=airportId==='military'?(landscape?.militaryBase || this.world?.militaryBase):airportId==='civilian'?landscape?.airport:null;
      if(!airport || this.ragdolls.get(this.player.id) || this.player.parachuting) return false;
      if(this.player.vehicleId && (!Aircraft.isAircraft(entity) || !entity.grounded || Math.abs(entity.speed)>20)) return false;
      if(!this.player.vehicleId && !this.player.grounded) return false;
      const nearHeight=pad=>Math.abs(this._base(entity)-finite(pad.elevation,this._ground(pad)))<3;
      const apron=(airport.aprons || []).some(pad=>entity.x>=pad.x-180 && entity.x<=pad.x+pad.w+180 && entity.y>=pad.y-180 && entity.y<=pad.y+pad.h+180 && nearHeight(pad));
      return apron || [...(airport.stands || []),...(airport.storageStands || []),...(airport.militaryStands || []),...(airport.helipads || [])].some(pad=>distance(entity,pad)<220 && nearHeight(pad));
    }

    _requireHangar() {
      if(this.hangarAvailable) return true;
      this._toast('Stop at an airfield apron or helipad to manage your hangar.'); return false;
    }

    _syncHangar() {
      for(const record of this.hangar.aircraft) {
        const craft=this.aircraft.find(value=>value.hangarId===record.id);
        if(craft) for(const key of ['color','health','maxHealth','engineHealth','handlingHealth','burning','fireTime','exploded']) record[key]=craft[key];
      }
    }

    hangarStore() {
      if(!this._requireHangar()) return false;
      const craft=this.current;
      if(!Aircraft.isAircraft(craft)) { this._toast('Bring an aircraft to the apron to save it.'); return false; }
      if(craft.burning || craft.exploded || craft.health<=0) { this._toast('Repair this aircraft before saving it.'); return false; }
      if(craft.hangarId && this.hangar.aircraft.some(record=>record.id===craft.hangarId)) { this._syncHangar(); this._toast('This aircraft is already saved.'); return false; }
      if(this.hangar.aircraft.length>=3) { this._toast('Your three hangar spaces are full. Release a saved aircraft first.'); return false; }
      let number=1; while(this.hangar.aircraft.some(record=>record.id==='air-'+number)) number++;
      const record={id:'air-'+number,kind:'aircraft',aircraftType:craft.aircraftType};
      craft.hangarId=record.id; craft.borrowed=true; this.hangar.aircraft.push(record); this._syncHangar();
      this._toast(Aircraft.getModel(craft).name+' saved to your hangar.','success'); this._sound('purchase'); return true;
    }

    hangarRetrieve(id) {
      if(!this._requireHangar()) return false;
      this._syncHangar();
      const record=this.hangar.aircraft.find(value=>value.id===id);
      if(!record) return false;
      if(record.health<=0 || record.burning || record.exploded) { this._toast('Repair this saved aircraft before retrieving it.'); return false; }
      const deployed=this.aircraft.find(value=>value.hangarId===id) || this.aircraft.find(value=>value.aircraftType===record.aircraftType && !value.hangarId && !value.borrowed && !value.npc && value.grounded && value.visible!==false && value.health>0 && !value.burning);
      const airportId=this.aviation.airportAt(this.current) || 'civilian';
      const position=this.aviation.parkingPosition(record.aircraftType,deployed,airportId);
      if(!position) { this._toast('The aircraft stand is crowded. Clear it and try again.'); return false; }
      if(this.player.vehicleId) { this.current.speed=this.current.vx=this.current.vy=0; this.current.throttle=0; }
      const craft=deployed || this.aviation.spawn(record.aircraftType,position,{npc:false,airportId,standId:position.id});
      this.aviation._releaseRunway(craft);
      Object.assign(craft,record,{x:position.x,y:position.y,angle:finite(position.angle,0),id:craft.id,hangarId:record.id,airportId,standId:position.id,home:{...position},visible:true,npc:false,phase:'parked',flightPhase:'parked',phaseTime:0,speed:0,vx:0,vy:0,vz:0,verticalVelocity:0,pitch:0,roll:0,throttle:0,grounded:true,upright:true,altitudeAGL:0,agl:0,burning:false,exploded:false,borrowed:true});
      craft.elevation=finite(position.elevation,this._ground(position));
      Object.assign(this.player,{vehicleId:craft.id,x:craft.x,y:craft.y,elevation:craft.elevation,angle:craft.angle,verticalVelocity:0,grounded:true,parachuting:false});
      this._toast(Aircraft.getModel(craft).name+' ready on the stand.','success'); this._sound('enter',{x:craft.x,y:craft.y,kind:'aircraft'}); return true;
    }

    hangarRepair(id) {
      if(!this._requireHangar()) return false;
      this._syncHangar();
      const record=this.hangar.aircraft.find(value=>value.id===id);
      if(!record) return false;
      if(!VehicleStats.isDamaged(record)) { this._toast('This aircraft is already in perfect condition.'); return false; }
      if(this.money<75) { this._toast('A hangar repair costs $75.','warning'); return false; }
      this.money-=75; VehicleStats.repair(record,finite(record.maxHealth,100));
      for(const craft of this.aircraft.filter(value=>value.hangarId===id)) VehicleStats.repair(craft,finite(craft.maxHealth,100));
      this._toast('Aircraft fully repaired for $75.','success'); this._sound('repair'); return true;
    }

    hangarRelease(id) {
      if(!this._requireHangar()) return false;
      const index=this.hangar.aircraft.findIndex(record=>record.id===id);
      if(index<0) return false;
      this.hangar.aircraft.splice(index,1);
      for(const craft of this.aircraft) if(craft.hangarId===id) delete craft.hangarId;
      this._toast('Hangar space released. Your deployed aircraft stays where it is.'); return true;
    }

    garageStore() {
      if (!this._requireGarage()) return false;
      if (!this.player.vehicleId || !this.cars.includes(this.current)) { this._toast('Drive a civilian car here to save it in your collection.'); return false; }
      const car = this.current;
      if (car.health <= 0 || car.burning) { this._toast('Repair this ride before adding it to your collection.'); return false; }
      if (car.garageId && this.garage.cars.some(record => record.id === car.garageId)) { this._syncGarage(); this._toast('This ride is already in your collection.'); return false; }
      if (this.garage.cars.length >= 3) { this._toast('Your three garage spaces are full.'); return false; }
      let number = 1;
      while (this.garage.cars.some(record => record.id === 'ride-' + number)) number++;
      const record = { id: 'ride-' + number, kind: car.kind, color: car.color, health: car.health };
      this.garage.cars.push(record); car.garageId = record.id; car.borrowed = true;
      this._syncGarage();
      this._toast(VehicleStats.getModel(car).name + ' saved! Your collection survives reloads.', 'success'); this._sound('purchase'); return true;
    }

    garageRetrieve(id) {
      if (!this._requireGarage()) return false;
      this._syncGarage();
      const record = this.garage.cars.find(car => car.id === id);
      if (!record) return false;
      if (record.health <= 0 || record.burning || record.exploded) { this._toast('Repair this ride in your collection before retrieving it.'); return false; }
      const deployed = this.cars.find(car => car.garageId === id);
      const garage = this.services.find(service => service.id === 'garage');
      const preview = { id: deployed ? deployed.id : '', kind: record.kind, angle: -Math.PI / 2, x: garage.x, y: garage.y };
      let position = null;
      // All retrieval pads stay within walking distance of the service. Check
      // the full rotated body against walls, cars, and pedestrians before moving it.
      for (const dy of [0, -60, 60, -100, 100]) for (const dx of [0, -20, 20, -60, 60, -100, 100]) {
        if (position || Math.hypot(dx, dy) >= 110) continue;
        const candidate = { ...preview, x: garage.x + dx, y: garage.y + dy, elevation:this._ground(garage.x+dx,garage.y+dy) };
        if(!this._dry(candidate)) continue;
        if (this._vehicleFree(candidate) && !this._vehicles().some(other => other !== deployed && this._vehicleContact(candidate, other)) &&
          !this.peds.some(ped => this._personVehicleContact(ped, candidate, 9))) position = candidate;
      }
      if (!position) { this._toast('Garage exit is crowded. Clear a little space and try again.'); return false; }
      if (this.player.vehicleId) { this.current.speed = this.current.vx = this.current.vy = 0; this.current.traffic = false; }
      const car = deployed || this._addCar(position.x, position.y, position.angle, record.kind, record.color);
      car.x = position.x; car.y = position.y; car.angle = position.angle;
      car.health = record.health; car.color = record.color; car.garageId = record.id;
      Object.assign(car, { modelId: VehicleStats.getModel(record).id, maxHealth: this.maxHealth,
        engineHealth: finite(record.engineHealth, 100), handlingHealth: finite(record.handlingHealth, 100),
        burning: false, fireTime: 0, exploded: false });
      if (isMilitaryUtility(record)) car.militaryModel = 'utility-truck';
      delete car.explosionTime;
      car.speed = car.vx = car.vy = 0; car.traffic = false; car.borrowed = true;
      car.elevation=position.elevation; this.vehiclePhysics.reset(car);
      this.player.vehicleId = car.id; this.player.x = car.x; this.player.y = car.y; this.player.angle = car.angle; this.player.elevation=car.elevation; this.player.verticalVelocity=0; this.player.grounded=true;
      this._toast(VehicleStats.getModel(car).name + ' retrieved. Ready for a spin!', 'success'); this._sound('enter', { x: car.x, y: car.y, kind: car.kind }); return true;
    }

    garageRepair(id) {
      if (!this._requireGarage()) return false;
      this._syncGarage();
      const record = this.garage.cars.find(car => car.id === id);
      if (!record) return false;
      if (!VehicleStats.isDamaged(record)) { this._toast('This collected ride is already in perfect condition.'); return false; }
      if (this.money < 45) { this._toast('A garage repair costs $45.', 'warning'); return false; }
      this.money -= 45; VehicleStats.repair(record, this.maxHealth);
      this.cars.filter(car => car.garageId === record.id).forEach(car => VehicleStats.repair(car, this.maxHealth));
      const garage = this.services.find(service => service.id === 'garage');
      this._toast('Collected ride fully repaired for $45. Ready to retrieve!', 'success'); this._sound('repair', { x: garage.x, y: garage.y }); return true;
    }

    garageRelease(id) {
      if (!this._requireGarage()) return false;
      const index = this.garage.cars.findIndex(car => car.id === id);
      if (index < 0) return false;
      this.garage.cars.splice(index, 1);
      for (const car of this.cars) if (car.garageId === id) delete car.garageId;
      this._toast('Garage space freed! The released ride stays in town.'); return true;
    }

    garagePaint(id, color) {
      if (!COLORS.includes(color) || !this._requireGarage()) return false;
      this._syncGarage();
      const record = this.garage.cars.find(car => car.id === id);
      if (!record) return false;
      if (record.color === color) { this._toast('That ride is already this color.'); return false; }
      if (this.money < 25) { this._toast('A fresh paint color costs $25.', 'warning'); return false; }
      this.money -= 25; record.color = color;
      this.cars.filter(car => car.garageId === record.id).forEach(car => { car.color = color; });
      const garage = this.services.find(service => service.id === 'garage');
      this._toast('Fresh sprinkles! New paint applied for $25.', 'success'); this._sound('paint', { x: garage.x, y: garage.y }); return true;
    }

    purchase(item) {
      if (!['repair', 'boost', 'armor'].includes(item)) return false;
      if (!this._requireGarage()) return false;
      if (item === 'repair') {
        if (!this.player.vehicleId) { this._toast('Hop in a car before buying a repair.'); return false; }
        if (!VehicleStats.isDamaged(this.current)) { this._toast('This ride is already in perfect condition.'); return false; }
        if (this.money < 45) { this._toast('A repair costs $45.', 'warning'); return false; }
        this.money -= 45; VehicleStats.repair(this.current, this.maxHealth);
      } else if (item === 'boost' || item === 'armor') {
        const level = this.upgrades[item], price = item === 'boost' ? 200 + level * 150 : 150 + level * 125;
        if (level >= 3) { this._toast('That upgrade is already maxed out.'); return false; }
        if (this.money < price) { this._toast('You need $' + price + ' for this upgrade.', 'warning'); return false; }
        this._syncGarage();
        this.money -= price; this.upgrades[item]++;
        if (item === 'armor') {
          this.cars.forEach(car => { if (car.health > 0) car.health = Math.min(this.maxHealth, car.health + 25); car.maxHealth = this.maxHealth; });
          this.garage.cars.forEach(record => { if (record.health > 0 && !this.cars.some(car => car.garageId === record.id)) record.health = Math.min(this.maxHealth, record.health + 25); });
        }
      } else return false;
      this._syncGarage();
      this._toast(item === 'repair' ? 'Fresh wheels! Car fully repaired.' : item + ' upgraded to level ' + this.upgrades[item] + '!', 'success');
      this._sound(item === 'repair' ? 'repair' : 'purchase', item === 'repair' ? { x: this.current.x, y: this.current.y } : {}); return true;
    }

    _addScore(points) { this.score = Math.min(999999, this.score + points); this.bestScore = Math.max(this.bestScore, this.score); }

    _style(points, message) {
      this._addScore(points);
      if (this.mission) this.missionStats.style += points;
      if (this._styleCooldown <= 0) { this._toast(message + ' +' + points + ' style', 'success'); this._sound('style'); this._styleCooldown = 5; }
    }

    update(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      let remaining = Math.min(dt, 0.25);
      while (remaining > 0.000001) { const step = Math.min(1 / 60, remaining); this._step(step, input); remaining -= step; }
    }

    _step(dt, input) {
      this.time += dt;
      for (const key of ['_troubleCooldown', '_impactCooldown', '_actionCooldown', '_hornCooldown', '_styleCooldown', 'graceTimer']) this[key] = Math.max(0, this[key] - dt);
      this.player.ragdollGrace = Math.max(0, (this.player.ragdollGrace || 0) - dt);
      this.player.bubbleTimer = Math.max(0, this.player.bubbleTimer - dt);
      if (!this.player.bubbleTimer) this.player.bubble = '';
      this.vehiclePhysics.sync();
      this.railTraffic.step(dt);
      if (this.player.vehicleId) { if (!Aircraft.isAircraft(this.current)) this._drive(this.current, dt, input); }
      else if (this.player.parachuting) this._parachuteStep(dt,input);
      else this._walk(dt, input);
      for (const car of this.cars) if (car.traffic && car.health > 0 && car.id !== this.player.vehicleId) this._traffic(car, dt);
      this._pedestrians(dt);
      this._updateWitnessReports(dt);
      this.aviation.step(dt,input);
      this._updatePolice(dt);
      const contacts = this.vehiclePhysics.step(dt);
      for (const contact of contacts) if (contact.prop && contact.speed > 75 && this.time - (contact.prop._lastImpactAt ?? -10) > .35) {
        contact.prop._lastImpactAt = this.time;
        this._damageProp(contact.prop, (contact.speed - 55) * .9, contact.entity, contact.entity.id === this.player.vehicleId);
      }
      for (const contact of contacts) this._impact(contact.entity, contact.speed, contact.vehicle,
        contact.vehicle ? 'vehicle' : PROP_SOUND_MATERIALS[contact.prop?.kind] || 'stone');
      for (const contact of contacts) if(Aircraft.isAircraft(contact.other) && contact.speed>65 && this.time-(contact.other._roadImpactAt ?? -10)>.6) {
        contact.other._roadImpactAt=this.time;this.aviation.damage(contact.other,(contact.speed-45)*.1);
      }
      this._vehicleDamageStep(dt);
      for (const vehicle of this._solidVehicles()) this._vehiclePeople(vehicle, vehicle.vx || 0, vehicle.vy || 0);
      if (this.player.vehicleId) {
        const car = this.current;
        if (!Aircraft.isAircraft(car) && !contacts.some(contact => contact.entity === car || contact.other === car)) this._nearMissStyle(car);
        this.player.x = car.x; this.player.y = car.y; this.player.angle = car.angle; this.player.elevation = car.elevation;
        this.player.verticalVelocity = car.verticalVelocity; this.player.grounded = car.grounded;
      }
      this._projectiles(dt);
      this._propExplosions();
      const finished = this.ragdolls.step(dt, { buildings: this.buildings, staticObjects: this.staticObjects, cars: this.cars, police: this.police, aircraft:(this.aircraft || []).filter(craft=>craft.visible!==false), railVehicles:this.railTraffic.colliders, size: SIZE, bounds:this._worldBounds(), terrain:this.world?.terrain });
      for (const body of finished) {
        const owner = body.owner;
        owner.stunned = 0; owner.ragdollGrace = 1.4;
        if (owner !== this.player) owner.angle = Math.atan2(owner.homeY - owner.y, owner.homeX - owner.x);
        this._resolvePerson(owner, owner === this.player ? PLAYER_RADIUS : NPC_RADIUS);
      }
      this._waterRecovery(dt);
      this.aliens.step(dt);
      if (this.mission) {
        this.missionStats.elapsed += dt;
        this.mission.timeLeft = Math.max(0, this.mission.timeLeft - dt);
        if (this.mission.timeLeft === 0 && !this.missionStats.overtime) { this.missionStats.overtime = true; this._toast('Overtime! Finish the gig anyway; base pay is safe.'); }
        const target = this.mission.targets[this.mission.targetIndex];
        if(this.mission.aircraftJob) this._airMissionStep(dt,target);
        else if (!this.ragdolls.get(this.player.id) && this.mission.type !== 'party' && (this.mission.type !== 'dash' || this.player.vehicleId) && distance(this.current, target) < 58 && Math.abs(this._base(this.current)-this._base(target))<3) this._advanceMission();
      }
      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-2 * dt); p.vy = p.vy * Math.exp(-2 * dt) + 18 * dt; }
      this.particles = this.particles.filter(p => p.life > 0);
      for (const piece of this.debris) {
        piece.life -= dt; piece.x += piece.vx * dt; piece.y += piece.vy * dt;
        piece.verticalVelocity -= 18 * dt; piece.elevation += piece.verticalVelocity * dt;
        const floor = this._ground(piece) + piece.size[1] / 2;
        if (piece.elevation < floor) {
          piece.elevation = floor;
          piece.verticalVelocity = Math.abs(piece.verticalVelocity) > 1 ? -piece.verticalVelocity * .25 : 0;
          piece.vx *= Math.exp(-7 * dt); piece.vy *= Math.exp(-7 * dt);
        }
      }
      this.debris = this.debris.filter(piece => piece.life > 0);
      this.skidMarks.forEach(mark => { mark.life -= dt; }); this.skidMarks = this.skidMarks.filter(mark => mark.life > 0).slice(-250);
    }

    _airMissionStep(dt,target) {
      const mission=this.mission,craft=this.current;
      if(!mission) return;
      if(!Aircraft.isAircraft(craft) || craft.exploded || craft.health<=0) {mission.boardingTime=0;return;}
      if(mission.type==='airtaxi' && mission.targetIndex>0) {
        const roughness=Math.max(0,Math.abs(finite(craft.verticalVelocity,0))-6)*.6+Math.max(0,Math.abs(finite(craft.roll,0))-.25)*12;
        const damage=Math.max(0,finite(mission._lastHealth,craft.health)-craft.health);
        this.missionStats.comfort=clamp(finite(this.missionStats.comfort,100)-roughness*dt-damage,0,100);
        mission._lastHealth=craft.health;
      }
      const landing=mission.landingJob || mission.type==='sightseeing' && mission.targetIndex===mission.targets.length-1;
      if(mission.landingJob && !Aircraft.getModel(craft).helicopter && !['helicopter','news','policeheli','transportheli'].includes(craft.aircraftType)) return;
      const inRange=distance(craft,target)<(landing?85:210) && Math.abs(this._base(craft)-this._base(target))<(landing?2:12);
      if(landing) {
        mission.boardingTime=inRange && craft.grounded && Math.abs(craft.speed)<20 ? (mission.boardingTime || 0)+dt : 0;
        if(mission.boardingTime>=2) { mission.boardingTime=0; this._advanceMission(); }
      } else if(inRange && !craft.grounded) this._advanceMission();
    }

    _walk(dt, input) {
      if (this.ragdolls.get(this.player.id)) return;
      if (input.jump && !this._jumpHeld) this.jump();
      this._jumpHeld = Boolean(input.jump);
      const wasGrounded = this.player.grounded;
      const feet = this.player.elevation;
      const onTerrain=this.player.grounded && Math.abs(feet-this._ground(this.player))<.2;
      this.player.verticalVelocity -= 18 * dt;
      const fallSpeed = Math.max(0, -this.player.verticalVelocity);
      this.player.elevation = feet + this.player.verticalVelocity * dt;
      if (this.player.verticalVelocity > 0) {
        const ceiling = this.vehiclePhysics.ceiling(this.player.x, this.player.y, feet + PERSON_HEIGHT, this.player.elevation + PERSON_HEIGHT);
        if (Number.isFinite(ceiling)) { this.player.elevation = Math.max(this._ground(this.player), ceiling - PERSON_HEIGHT - 0.005); this.player.verticalVelocity = 0; }
      }
      const forward = Number(Boolean(input.up)) - Number(Boolean(input.down));
      const strafe = Number(Boolean(input.right)) - Number(Boolean(input.left));
      let x = strafe, y = -forward;
      if (Number.isFinite(input.moveAngle)) {
        x = forward * Math.cos(input.moveAngle) + strafe * Math.cos(input.moveAngle + Math.PI / 2);
        y = forward * Math.sin(input.moveAngle) + strafe * Math.sin(input.moveAngle + Math.PI / 2);
      }
      const length = Math.hypot(x, y);
      if (length) {
        x /= length; y /= length; this.player.angle = Math.atan2(y, x);
        const dx = x * (input.boost ? 220 : 155) * dt, dy = y * (input.boost ? 220 : 155) * dt;
        if(onTerrain) { this.player.elevation=this._ground(this.player.x+dx,this.player.y+dy); this.player.verticalVelocity=0; }
        const landing = this.vehiclePhysics.support(this.player.x + dx, this.player.y + dy, feet + 0.045);
        if (this.player.verticalVelocity <= 0 && feet >= landing && this.player.elevation <= landing + 0.015) {
          this.player.elevation = landing; this.player.verticalVelocity = 0;
        }
        this._move(this.player, dx, dy, PLAYER_RADIUS);
        if(onTerrain) this.player.elevation=this._ground(this.player);
      }
      const support = this.vehiclePhysics.support(this.player.x, this.player.y, Math.max(feet, this.player.elevation) + 0.045);
      if (this.player.verticalVelocity <= 0 && this.player.elevation <= support + 0.015) {
        this.player.elevation = support; this.player.verticalVelocity = 0; this.player.grounded = true;
        if (!wasGrounded && fallSpeed > .3) this._sound('land', { x: this.player.x, y: this.player.y, intensity: clamp(fallSpeed / 11, .15, 1) });
      } else this.player.grounded = false;
    }

    jump() {
      if (this.player.vehicleId || this.player.parachuting || this.ragdolls.get(this.player.id) || !this.player.grounded || this.player.stunned > 0) return false;
      this.player.verticalVelocity = 7.2; this.player.grounded = false; this._sound('jump', { x: this.player.x, y: this.player.y }); return true;
    }

    _waterRecovery(dt) {
      const terrain=this.world?.terrain;
      if(!terrain) return;
      for(const entity of this._vehicles().concat(this.player.vehicleId ? [] : [this.player])) {
        const submerged=terrain.isWater(entity.x,entity.y) && this._base(entity)<finite(terrain.waterLevel,0)-.4;
        if(!submerged) { entity.waterTimer=0; entity._submerged=false; continue; }
        if(!entity._submerged) {
          entity._submerged=true;
          this._sound('splash', { x: entity.x, y: entity.y, intensity: clamp(Math.max(Math.hypot(entity.vx || 0, entity.vy || 0) / 220, -finite(entity.verticalVelocity, 0) / 12), .25, 1) });
        }
        entity.waterTimer=(entity.waterTimer || 0)+dt;
        if(entity.waterTimer<.6) continue;
        const current=entity===this.current,vehicle=entity!==this.player;
        const point=this._safeRoadPosition(entity,vehicle ? 18 : PLAYER_RADIUS,vehicle ? entity : null);
        entity.x=point.x; entity.y=point.y; entity.angle=point.angle; entity.elevation=this._ground(point);
        entity.waterTimer=0; entity._submerged=false; entity.verticalVelocity=0; entity.grounded=true;
        if(vehicle) { this.vehiclePhysics.reset(entity); entity.route=[]; entity.routeTimer=0; }
        if(current) {
          this.ragdolls.clear(this.player.id); this.player.stunned=0; this.player.ragdollGrace=1.4;
          this.player.x=entity.x; this.player.y=entity.y; this.player.elevation=entity.elevation;
          this.player.verticalVelocity=0; this.player.grounded=true; this.graceTimer=2;
          this._toast('Splash! Back to the road.','warning'); this._confetti(point.x,point.y,28);
        }
      }
    }

    _drive(car, dt, input) {
      const type = VehicleStats.getModel(car);
      const max = type.maxSpeed * (input.boost ? 1.2 + this.upgrades.boost * 0.075 : 1);
      const steer = Number(Boolean(input.right)) - Number(Boolean(input.left));
      this.vehiclePhysics.control(car, { ...input, steer, maxSpeed: max });
      const impact = Math.hypot(car.vx, car.vy);
      if (!this.player.vehicleId) return;
      this.player.x = car.x; this.player.y = car.y; this.player.angle = car.angle;
      if (input.brake && steer && impact > 75) {
        this._driftTime += dt;
        if (Math.floor(this.time * 18) !== Math.floor((this.time - dt) * 18)) this.skidMarks.push({ x: car.x, y: car.y, angle: car.angle, life: 12 });
        if (this._driftTime > 0.5 && this._styleCooldown <= 0) { this._style(15, 'Biscuit drift!'); this._driftTime = 0; }
      } else this._driftTime = Math.max(0, this._driftTime - dt * 2);
      const service = this.services.find(s => s.id === 'wash' && distance(s, car) < 85 && Math.abs(car.speed) < 20);
      this.nearWash = Boolean(service);
    }

    _nearMissStyle(car) {
      if (Math.hypot(car.vx, car.vy) <= 170) return;
      for (const other of this.cars) {
        if (other === car || other.health <= 0) continue;
        if (distance(car, other) < 70 && !this._vehicleContact(car, other) && this.time - (this._nearMisses.get(other.id) ?? -20) > 14) {
          this._nearMisses.set(other.id, this.time); this._style(8, 'Close shave!');
        }
      }
    }

    _impact(car, speed, traffic, material = traffic ? 'vehicle' : 'stone') {
      // Debounce each chassis independently; the solver reports both vehicles.
      const driven = car.id === this.player.vehicleId;
      if (!Number.isFinite(speed) || speed <= 30 || car.exploded || driven && this.graceTimer > 0) return;
      if (speed <= 65) {
        if (distance(car, this.current) < 300 && this.time - (car._impactSoundAt ?? -10) >= .25) {
          car._impactSoundAt = this.time;
          this._sound('crash', { x: car.x, y: car.y, sourceId: car.id, intensity: clamp(speed / 330, .1, 1), material });
        }
        return;
      }
      if (this.time - (car._impactAt ?? -10) < .6) return;
      car._impactAt = this.time;
      const model = VehicleStats.getModel(car), armor = driven || car.garageId ? 1 + this.upgrades.armor * 0.1 : 1;
      this._damageVehicle(car, (speed - 50) * 0.11 / (model.mass * model.durability * armor));
      if (distance(car, this.current) < 300) {
        this._confetti(car.x, car.y, 16);
        if (this.time - (car._impactSoundAt ?? -10) >= .25) {
          car._impactSoundAt = this.time;
          this._sound('crash', { x: car.x, y: car.y, sourceId: car.id, intensity: clamp(speed / 330, .2, 1), material });
        }
      }
      if (driven) {
        if (this.mission) this.missionStats.collisions++;
        if (traffic && speed > 140) this._raiseHeat(1, 'Heavy traffic collision', { position: car, noise: 220 });
      }
    }

    _damageVehicle(car, amount) {
      if(car.railModel)return;
      if(Aircraft.isAircraft(car)) return this.aviation.damage(car,amount);
      if (car.exploded || !Number.isFinite(amount) || amount <= 0) return;
      const model = VehicleStats.getModel(car);
      car.maxHealth = finite(car.maxHealth, this.maxHealth);
      car.health = Math.max(0, finite(car.health, car.maxHealth) - amount);
      car.engineHealth = Math.max(0, finite(car.engineHealth, 100) - amount * 1.15 / model.engineDurability);
      car.handlingHealth = Math.max(0, finite(car.handlingHealth, 100) - amount * 0.85);
      if (!car.burning && (car.engineHealth <= 22 || VehicleStats.condition(car) <= 0.18)) {
        car.burning = true; car.fireTime = 0;
        this._sound('fire-start', { x: car.x, y: car.y });
        if (distance(car, this.current) < 200) this._toast(car.id === this.player.vehicleId ? 'ENGINE FIRE! E to bail out, or stop and use Repair Tape before it blows!' : 'That engine is on fire. Keep clear!', 'warning');
      }
      if (car.health <= 0) this._wreckVehicle(car);
    }

    _wreckVehicle(car) {
      car.health = 0; car.traffic = false;
      if (car.id === this.player.vehicleId) {
        this._exitCar(car, true); this.graceTimer = 2;
        this._toast('Your ride is wrecked! Keep clear of the fire and borrow another.', 'warning');
      }
    }

    _vehicleDamageStep(dt) {
      for (const car of this._vehicles()) {
        if (!car.burning || car.exploded) continue;
        car.fireTime = finite(car.fireTime, 0) + dt;
        car.health = Math.max(0, car.health - dt * 2.5);
        car.engineHealth = Math.max(0, car.engineHealth - dt * 7);
        car.handlingHealth = Math.max(0, car.handlingHealth - dt * 3);
        if (car.health <= 0) this._wreckVehicle(car);
        if (car.fireTime >= 8) this._explodeVehicle(car);
      }
    }

    _explodeVehicle(car) {
      if (car.exploded) return false;
      car.exploded = true; car.burning = false; car.fireTime = 0; car.explosionTime = this.time;
      car.engineHealth = car.handlingHealth = 0; this._wreckVehicle(car);
      this.vehiclePhysics.impulse(car, { x: 0, y: 3.2, z: 0 });
      if (distance(car, this.current) < 400) { this._sound('explosion', { x: car.x, y: car.y, intensity: 1 }); this._confetti(car.x, car.y, 65, finite(car.elevation, 0) + 0.8); }
      this._blastFrom(car);
      return true;
    }

    _onAircraftExplosion(craft) { this._blastFrom(craft); }

    _blastFrom(car) {
      // Delayed chain fires give nearby drivers the same chance to get away.
      const radius = 160, height = finite(car.elevation, 0) + 0.7;
      for (const other of this._solidVehicles()) {
        const reach = Math.hypot(distance(car, other), (finite(other.elevation, 0) + 0.7 - height) * VehiclePhysics.SCALE);
        if (other === car || reach >= radius) continue;
        const strength = 1 - reach / radius, heading = Math.atan2(other.y - car.y, other.x - car.x);
        this._damageVehicle(other, 65 * strength);
        if(Aircraft.isAircraft(other)) {other.speed+=Math.cos(heading-other.angle)*120*strength;other.vz+=3*strength;other.verticalVelocity=other.vz;}
        else this.vehiclePhysics.impulse(other, { x: Math.cos(heading) * 6 * strength, y: 3 * strength, z: Math.sin(heading) * 6 * strength });
      }
      for (const person of this.peds.concat(this.player.vehicleId ? [] : [this.player])) {
        const reach = Math.hypot(distance(car, person), (finite(person.elevation, 0) + PERSON_HEIGHT / 2 - height) * VehiclePhysics.SCALE);
        if (reach >= radius || person === this.player && this.graceTimer > 0) continue;
        const strength = 1 - reach / radius, heading = Math.atan2(person.y - car.y, person.x - car.x);
        this._knockDown(person, { x: Math.cos(heading) * 7 * strength, y: 2 + 3 * strength, z: Math.sin(heading) * 7 * strength });
        if (person === this.player) person.composure = Math.max(10, person.composure - 40 * strength);
      }
      return true;
    }

    _traffic(car, dt) {
      if (!car.route || !car.route.length) car.route = this._wanderRoute(car);
      this._advanceRoute(car, car.route);
      if (car.route.length === 1 && distance(car,car.route[0])<22) car.route = this._wanderRoute(car);
      const target = this._routeTarget(car,car.route,clamp(42+Math.abs(car.speed)*.35,45,75));
      const angle = Math.atan2(target.y - car.y, target.x - car.x), error=Math.abs(wrapAngle(angle-car.angle));
      const desired = error>1.15 ? 12 : error>.65 ? 22 : error>.35 ? 52 : 100;
      const speed = this._trafficSpeed(car,angle,desired);
      this.vehiclePhysics.control(car, { targetSpeed: speed, heading: angle });
      const blocker=this._vehicles().find(other=>other.id===car.blockedBy);
      if(Math.abs(car.speed)<8 && speed<8 && blocker?.traffic && Math.abs(blocker.speed)<8) {
        car.yieldTimer=(car.yieldTimer || 0)+dt;
        const delay=1.2+(parseInt(car.id.replace(/\D/g,''),10) || 0)*.03;
        if(car.yieldTimer>delay) {
          // Rejoin the correct lane after a bumper nudge or a tight turn.
          // Staggered refreshes give the first arrival a clear path without
          // changing its destination or moving either physical body.
          const goal=this.network.nodeById.get(car.wanderGoal);
          if(goal) car.route=this._roadRoute(car,goal,18);
          car.yieldTimer=0;
        }
      } else car.yieldTimer=0;
      if (Math.abs(car.speed) < 8 && speed > 25) car.blockedTime = (car.blockedTime || 0) + dt;
      else car.blockedTime = Math.max(0, (car.blockedTime || 0) - dt);
      if (car.blockedTime > 2.5) { car.route = this._wanderRoute(car); car.blockedTime = 0; }
    }

    _trafficSpeed(car,heading,desired) {
      const type=CAR_TYPES[car.kind] || CAR_TYPES.compact,c=Math.cos(heading),s=Math.sin(heading);
      let speed=desired; car.blockedBy=null;
      for(const other of this._vehicles()) {
        if(other===car || distance(other,car)>100 || !this._heightOverlap(car,other,VehiclePhysics.height(car),VehiclePhysics.height(other))) continue;
        const dx=other.x-car.x,dy=other.y-car.y,along=dx*c+dy*s,lateral=Math.abs(-dx*s+dy*c);
        const otherType=CAR_TYPES[other.kind] || CAR_TYPES.compact,angle=(other.angle || 0)-heading;
        const otherWidth=(otherType.width*Math.abs(Math.cos(angle))+otherType.length*Math.abs(Math.sin(angle)))/2;
        const otherLength=(otherType.length*Math.abs(Math.cos(angle))+otherType.width*Math.abs(Math.sin(angle)))/2;
        // Opposing lanes are close, but a neighboring lane must not count as
        // an obstacle unless the actual swept vehicle widths overlap.
        if(along<=0 || lateral>type.width/2+otherWidth+2) continue;
        const gap=type.length/2+otherLength+6;
        const allowed=Math.max(0,(along-gap)*2);
        if(allowed<speed) { speed=allowed; car.blockedBy=other.id; }
      }
      return this.railTraffic?.roadSpeedLimit(car,heading,speed) ?? speed;
    }

    _pedestrians(dt) {
      for (const ped of this.peds) {
        ped.ragdollGrace = Math.max(0, (ped.ragdollGrace || 0) - dt);
        ped.bubbleTimer = Math.max(0, ped.bubbleTimer - dt);
        if (!ped.bubbleTimer) ped.bubble = '';
        if (ped.stunned > 0 || this.ragdolls.get(ped.id)) { ped.stunned = Math.max(0, ped.stunned - dt); continue; }
        const path = ped.pathId && this.pedPaths.find(candidate => candidate.id===ped.pathId);
        if (path) {
          let target = path.points[ped.pathIndex];
          if (distance(ped,target)>150) {
            ped.pathIndex = path.points.reduce((best,point,index) => distance(point,ped)<distance(path.points[best],ped) ? index : best,0);
            target = path.points[ped.pathIndex];
          }
          if (distance(ped,target)<3) {
            if (ped.pathIndex + ped.pathDirection<0 || ped.pathIndex + ped.pathDirection>=path.points.length) ped.pathDirection *= -1;
            ped.pathIndex += ped.pathDirection; target = path.points[ped.pathIndex];
          }
          ped.angle = Math.atan2(target.y-ped.y,target.x-ped.x);
        } else if (distance(ped, { x: ped.homeX, y: ped.homeY }) > 85) ped.angle = Math.atan2(ped.homeY - ped.y, ped.homeX - ped.x);
        const dx = Math.cos(ped.angle) * ped.pace * dt, dy = Math.sin(ped.angle) * ped.pace * dt;
        if(this.railTraffic?.pedestrianBlocked(ped,dx,dy))continue;
        ped.elevation=this._ground(ped.x+dx,ped.y+dy);
        if (this._move(ped, dx, dy, NPC_RADIUS)) {
          if (path) { ped.pathDirection *= -1; ped.pathIndex = clamp(ped.pathIndex + ped.pathDirection,0,path.points.length-1); }
          else ped.angle = wrapAngle(ped.angle + Math.PI * (0.65 + this._random() * 0.2));
        }
        ped.elevation=this._ground(ped); ped.verticalVelocity=0; ped.grounded=true;
      }
    }

    _updatePolice(dt) {
      // The fourth star calls in Northwatch; civilian patrols retain their
      // existing three-star count, visibility and pursuit speed.
      const policeHeat = Math.min(this.heat, MAX_POLICE_HEAT);
      const wanted = Math.max(1, policeHeat);
      const disabled = this.police.filter(cop => cop.health <= 0 || cop.burning || cop.exploded).slice(-3);
      this.police = this.police.filter(cop => cop.health > 0 && !cop.burning && !cop.exploded).slice(0, wanted).concat(disabled);
      let activeCount = this.police.length - disabled.length;
      while (activeCount < wanted) {
        const candidates = this.nodes.map(node => ({ ...node, angle: this._roadPosition(node).angle,elevation:this._ground(node) })).filter(node => distance(this.current,node)>440 && this._dry(node) &&
          this._vehicleFree({ ...node,kind:'compact' }) && this._vehicles().every(vehicle => distance(vehicle,node)>100));
        candidates.sort((a, b) => Math.abs(distance(this.current, a) - 650) - Math.abs(distance(this.current, b) - 650));
        const point = candidates.length ? candidates[0] : this._safeRoadPosition({ x:this.current.x+650,y:this.current.y },18);
        this.police.push({ id: 'police-' + this._nextId++, ...this._vehicleState('compact'), x:point.x,y:point.y,angle:point.angle || 0,elevation:this._ground(point),verticalVelocity:0,grounded:true,speed: 0, route: [], routeTimer: 0, lastSeen: { x: (this._reportedLocation || this.current).x, y: (this._reportedLocation || this.current).y } });
        activeCount++;
      }
      let seen = Boolean(this.airPoliceSeen && this.heat>0 && this.graceTimer<=0), contact = false;
      if(seen) {
        this._reportedLocation={x:this.current.x,y:this.current.y,elevation:this._base(this.current)};
        for(const cop of this.police) cop.lastSeen={...this._reportedLocation};
      }
      for (const cop of this.police) {
        if (cop.health <= 0 || cop.burning || cop.exploded) continue;
        cop.distracted = Math.max(0, (cop.distracted || 0) - dt);
        const sightRange=Math.hypot(distance(cop,this.current),(this._base(cop)-this._base(this.current))*20);
        const sight = this.heat > 0 && cop.distracted <= 0 && this.graceTimer <= 0 && sightRange < 340 + policeHeat * 65 && !this._blockedLine(cop,this.current);
        if (sight) { seen = true; cop.lastSeen = { x: this.current.x, y: this.current.y }; this._reportedLocation = { ...cop.lastSeen }; }
        cop.routeTimer -= dt;
        if (cop.routeTimer <= 0 || !cop.route.length) {
          if (this.heat) cop.route = this._roadRoute(cop, cop.lastSeen);
          else cop.route = this._wanderRoute(cop);
          cop.routeTimer = this.heat ? 1.1 : 5;
        }
        const direct = sight && distance(cop,this.current)<125 && this._roadPosition(cop).roadId===this._roadPosition(this.current).roadId;
        if (!direct) this._advanceRoute(cop,cop.route,18);
        let target = direct ? this.current : this._routeTarget(cop,cop.route,clamp(45+Math.abs(cop.speed)*.35,50,90));
        if (target && distance(cop, target) > 10 && cop.distracted <= 0) {
          const heading = Math.atan2(target.y - cop.y, target.x - cop.x);
          const error=Math.abs(wrapAngle(heading-cop.angle));
          const desired = error>1.2 ? 14 : error>.7 ? 25 : (this.heat ? 160 + policeHeat * 25 : 75) * (error>.4 ? .55 : 1);
          this.vehiclePhysics.control(cop, { targetSpeed: this.heat ? this.railTraffic.roadSpeedLimit(cop,heading,desired) : this._trafficSpeed(cop,heading,desired), heading });
        } else this.vehiclePhysics.control(cop, { targetSpeed: 0, heading: cop.angle });
        let close;
        if (this.player.vehicleId) { const box = this._vehicleBox(this.current); box.half = box.half.map(n => n + 5); close = this._heightOverlap(this.current, cop, VehiclePhysics.height(this.current), VehiclePhysics.height(cop)) && boxContact(this._vehicleBox(cop), box); }
        else close = this._personVehicleContact(this.player, cop, 14 * CHARACTER_SCALE);
        if (this.heat > 0 && this.graceTimer <= 0 && cop.distracted <= 0 && close) contact = true;
      }
      this.policeSeen = seen;
      if (this.heat > 0) {
        const searching = !seen;
        if (searching && !this._policeSearching) this._sound('search', { level: this.heat });
        this._policeSearching = searching;
        this.escapeTimer = seen ? 0 : this.escapeTimer + dt;
        if (this.escapeTimer >= this.escapeGoal) { this._clearHeat(); this._toast('Fun Police escaped! Back to the biscuits.', 'success'); this._sound('escape'); this._addScore(25); }
      } else { this.escapeTimer = 0; this._policeSearching = false; }
      this.player.composure = clamp(this.player.composure + (contact ? -27 : 7) * dt, 0, 100);
      if (this.player.composure <= 0) this._caught();
    }

    exportSave() {
      this._syncGarage();
      this._syncHangar();
      return {
        version: 2, money: this.money, score: this.score, bestScore: this.bestScore, completed: this.completed, upgrades: { ...this.upgrades },
        inventory: { equipped: this.inventory.equipped, unlocked: this.inventory.unlocked.slice(), pockets: { ...this.inventory.pockets }, ammo: { ...this.inventory.ammo } },
        garage: { cars: this.garage.cars.map(car => ({ ...car })) },
        hangar: { aircraft: this.hangar.aircraft.map(craft => ({ ...craft })) }
      };
    }

    loadSave(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data) || ![undefined, 1, 2].includes(data.version)) return false;
      const upgrades = data.upgrades && typeof data.upgrades === 'object' ? data.upgrades : {};
      this.money = numeric(data.money, 150, 0, 999999);
      this.score = numeric(data.score, 0, 0, 999999);
      this.bestScore = Math.max(this.score, numeric(data.bestScore, 0, 0, 999999));
      this.completed = numeric(data.completed, 0, 0, 9999);
      const oldArmor = this.upgrades.armor;
      this.upgrades.boost = numeric(upgrades.boost, 0, 0, 3);
      this.upgrades.armor = numeric(upgrades.armor, 0, 0, 3);
      this.cars.forEach(car => { if (car.health > 0) car.health = clamp(car.health + (this.upgrades.armor - oldArmor) * 25, 0, this.maxHealth); car.maxHealth = this.maxHealth; });
      const defaults = starterInventory();
      const inventory = data.version === 2 && data.inventory && typeof data.inventory === 'object' && !Array.isArray(data.inventory) ? data.inventory : {};
      const unlocked = ['popper'];
      if (Array.isArray(inventory.unlocked)) for (const id of inventory.unlocked.slice(0, 20)) if (owns(GADGETS, id) && !unlocked.includes(id)) unlocked.push(id);
      const pockets = {}, savedPockets = inventory.pockets && typeof inventory.pockets === 'object' ? inventory.pockets : {};
      for (const id of Object.keys(POCKET_ITEMS)) pockets[id] = numeric(savedPockets[id], defaults.pockets[id], 0, POCKET_ITEMS[id].cap);
      const savedAmmo = inventory.ammo && typeof inventory.ammo === 'object' ? inventory.ammo : {};
      this.inventory = {
        equipped: unlocked.includes(inventory.equipped) ? inventory.equipped : 'popper', unlocked, pockets,
        ammo: { cannon: unlocked.includes('cannon') ? numeric(savedAmmo.cannon, 0, 0, 12) : 0 }
      };
      const records = data.version === 2 && data.garage && Array.isArray(data.garage.cars) ? data.garage.cars : [];
      const cars = [];
      for (const record of records.slice(0, 30)) {
        if (cars.length >= 3) break;
        const military = isMilitaryUtility(record);
        if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !/^ride-[1-9][0-9]{0,3}$/.test(record.id) ||
          cars.some(car => car.id === record.id) || !owns(CAR_TYPES, record.kind) || !(COLORS.includes(record.color) || (military && MILITARY_COLORS.includes(record.color)))) continue;
        const health = clamp(finite(record.health, 0), 0, this.maxHealth);
        const legacyCondition = health / this.maxHealth * 100;
        cars.push({ id: record.id, kind: record.kind, modelId: VehicleStats.getModel(record).id,
          ...(military ? { militaryModel: 'utility-truck' } : {}),
          color: record.color, health, maxHealth: this.maxHealth,
          engineHealth: clamp(finite(record.engineHealth, legacyCondition), 0, 100),
          handlingHealth: clamp(finite(record.handlingHealth, legacyCondition), 0, 100),
          burning: record.burning === true && record.exploded !== true,
          fireTime: clamp(finite(record.fireTime, 0), 0, 8), exploded: record.exploded === true });
      }
      this.garage = { cars };
      const savedAircraft = data.version===2 && data.hangar && Array.isArray(data.hangar.aircraft) ? data.hangar.aircraft : [];
      const aircraft=[];
      for(const record of savedAircraft.slice(0,30)) {
        if(aircraft.length>=3) break;
        if(!record || typeof record!=='object' || typeof record.id!=='string' || !/^air-[1-9][0-9]{0,3}$/.test(record.id) ||
          aircraft.some(craft=>craft.id===record.id) || !owns(Aircraft.AIRCRAFT_TYPES,record.aircraftType)) continue;
        const maxHealth=clamp(finite(record.maxHealth,100),1,500);
        aircraft.push({id:record.id,kind:'aircraft',aircraftType:record.aircraftType,color:typeof record.color==='string' && /^#[0-9a-f]{6}$/i.test(record.color)?record.color:'#ffd15b',
          maxHealth,health:clamp(finite(record.health,maxHealth),0,maxHealth),engineHealth:clamp(finite(record.engineHealth,100),0,100),handlingHealth:clamp(finite(record.handlingHealth,100),0,100),
          burning:record.burning===true && record.exploded!==true,fireTime:clamp(finite(record.fireTime,0),0,8),exploded:record.exploded===true});
      }
      this.hangar={aircraft};
      const deployedAircraft=new Set();
      for(const craft of this.aircraft) if(craft.hangarId) {
        const record=aircraft.find(value=>value.id===craft.hangarId);
        if(record && !deployedAircraft.has(record.id) && record.aircraftType===craft.aircraftType) { deployedAircraft.add(record.id);Object.assign(craft,{...record,id:craft.id,hangarId:record.id}); }
        else delete craft.hangarId;
      }
      const deployed = new Set();
      for (const car of this.cars) if (car.garageId) {
        const record = cars.find(saved => saved.id === car.garageId);
        if (record && !deployed.has(record.id) && record.kind === car.kind) {
          deployed.add(record.id); Object.assign(car, { ...record, id: car.id, garageId: record.id });
          delete car.explosionTime;
        } else delete car.garageId;
      }
      return true;
    }
  }

  Game.SIZE = SIZE;
  Game.MAX_HEAT = MAX_HEAT;
  const api = { Game, SIZE, MAX_HEAT, ROAD_CENTERS, ROAD_WIDTH, SIDEWALK_WIDTH, BUILDING_SETBACK, DISTRICTS, districtAt, CAR_TYPES, CAR_MODELS, VehicleStats, GADGETS, POCKET_ITEMS, PAINT_COLORS: Object.freeze(COLORS.slice()) };
  root.MayhemCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
