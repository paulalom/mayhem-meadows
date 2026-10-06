(function (root) {
  'use strict';

  const SIZE = 2160;
  const ROAD_CENTERS = [180, 540, 900, 1260, 1620, 1980];
  const ROAD_WIDTH = 104;
  const CAR_TYPES = {
    compact: { name: 'Pocket Rocket', maxSpeed: 300, acceleration: 430, handling: 2.7, grip: 9, mass: 1, width: 27, length: 46 },
    sports: { name: 'Sprinkle GT', maxSpeed: 370, acceleration: 490, handling: 2.5, grip: 6, mass: 0.9, width: 28, length: 49 },
    van: { name: 'Party Wagon', maxSpeed: 260, acceleration: 340, handling: 2.1, grip: 10, mass: 1.4, width: 32, length: 55 }
  };
  const COLORS = ['#ffd15b', '#fb8097', '#67d3c8', '#a6a0fa', '#90c66b', '#6fb5eb'];
  const GADGETS = {
    popper: { name: 'Confetti Popper', description: 'Unlimited bursts of close-up silliness.', price: 0, cooldown: 0.55 },
    hammer: { name: 'Inflatable Hammer', description: 'A short, satisfying shove. No refills needed.', price: 120, cooldown: 0.9 },
    cannon: { name: 'Party Cannon', description: 'Lob a party ball that showers a crowd in confetti.', price: 280, cooldown: 1.1 }
  };
  const POCKET_ITEMS = {
    biscuits: { name: 'Biscuits', description: 'Restore 40 composure.', price: 15, cap: 5 },
    repairTape: { name: 'Repair Tape', description: 'Restore 55 condition to your stopped car.', price: 35, cap: 3 },
    refill: { name: 'Party Refill', description: 'Add 6 Party Cannon shots, up to 12.', price: 30, cap: 3 }
  };
  const owns = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);
  const starterInventory = () => ({ equipped: 'popper', unlocked: ['popper'], pockets: { biscuits: 2, repairTape: 1, refill: 1 }, ammo: { cannon: 0 } });
  const CURSES = ['SON OF A BISCUIT!', 'HECKITY HECK!', 'FLIPPIN’ TURNIPS!', 'OH, CRUMBS!', 'YOU ABSOLUTE WAFFLE!'];
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const wrapAngle = n => Math.atan2(Math.sin(n), Math.cos(n));
  const finite = (n, fallback) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  const numeric = (n, fallback, min, max) => clamp(Math.floor(finite(n, fallback)), min, max);
  const Physics = root.MayhemPhysics || (typeof require === 'function' ? require('./physics.js') : null);

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
      this.heat = 0;
      this.escapeTimer = 0;
      this.policeSeen = false;
      this.graceTimer = 2;
      this.mission = null;
      this.missionStats = { elapsed: 0, collisions: 0, style: 0, overtime: false };
      this.player = { id: 'player', x: 884, y: 1080, angle: -Math.PI / 2, vehicleId: null, composure: 100, ragdollGrace: 0, stunned: 0, bubble: '', bubbleTimer: 0 };
      this.ragdolls = new Physics.RagdollWorld();
      this.physics = this.ragdolls;
      this.cars = [];
      this.peds = [];
      this.police = [];
      this.buildings = [];
      this.particles = [];
      this.projectiles = [];
      this.skidMarks = [];
      this.services = [
        { id: 'garage', x: 900, y: 900, label: 'Sprinkle Garage' },
        { id: 'wash', x: 1620, y: 1980, label: 'Cool-Down Car Wash · $75' }
      ];
      this._troubleCooldown = 0;
      this._impactCooldown = 0;
      this._actionCooldown = 0;
      this._hornCooldown = 0;
      this._styleCooldown = 0;
      this._driftTime = 0;
      this._nearMisses = new Map();
      this._makeTown();
    }

    get current() { return this.cars.find(car => car.id === this.player.vehicleId) || this.player; }
    get escapeGoal() { return this.heat > 0 ? 8 + this.heat * 6 : 0; }
    get maxHealth() { return 100 + this.upgrades.armor * 25; }
    get garageAvailable() {
      const garage = this.services.find(service => service.id === 'garage');
      return Boolean(garage && distance(this.current, garage) < 115 &&
        (!this.player.vehicleId || Math.abs(this.current.speed) <= 45) && !this.ragdolls.get(this.player.id));
    }

    _random() { this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0; return this._seed / 4294967296; }
    _pick(items) { return items[Math.floor(this._random() * items.length)]; }
    _toast(text, kind = 'info') { this._events.push({ type: 'toast', text, kind }); }
    _sound(name) { this._events.push({ type: 'sound', name }); }
    drainEvents() { return this._events.splice(0); }

    _makeTown() {
      const names = ['Biscuit Bank', 'Waffle Works', 'Disco Depot', 'Sprinkle Shop', 'Crumb Café', 'The Noodle Hut', 'Bean Palace', 'Fudge Factory'];
      for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
        const x = ROAD_CENTERS[col] + 60, y = ROAD_CENTERS[row] + 60;
        if (x === 960 && y === 960) continue;
        this.buildings.push({ x, y, w: 240, h: 240, height: [5.3, 7, 4.5, 6.2, 8.2][this.buildings.length % 5], color: COLORS[(row + col * 2) % COLORS.length], name: names[(row * 5 + col) % names.length] });
      }
      this._addCar(916, 1080, -Math.PI / 2, 'compact', '#ffd15b');
      const parked = [[540, 730], [1260, 370], [1620, 1080], [180, 1520], [1980, 720], [1260, 1770], [540, 1910], [1980, 1730]];
      parked.forEach(([x, y], i) => this._addCar(x + (i % 2 ? -22 : 22), y, -Math.PI / 2, ['compact', 'sports', 'van'][i % 3], COLORS[i % COLORS.length]));
      for (let i = 0; i < 13; i++) {
        const col = i % 6, row = (Math.floor(i / 6) * 2 + 1) % 6;
        const car = this._addCar(ROAD_CENTERS[col], ROAD_CENTERS[row], i % 2 ? 0 : Math.PI / 2, ['compact', 'van', 'sports'][i % 3], COLORS[(i + 2) % COLORS.length], true);
        car.route = this._wanderRoute(car);
      }
      for (let i = 0; i < 36; i++) {
        const vertical = i % 2 === 0, road = ROAD_CENTERS[i % 6];
        const along = 280 + Math.floor(i / 6) * 280;
        this.peds.push({ id: 'ped-' + i, x: vertical ? road + (i % 4 ? -54 : 54) : along, y: vertical ? along : road + (i % 4 ? 54 : -54), angle: vertical ? Math.PI / 2 : 0, stunned: 0, bubble: '', bubbleTimer: 0, homeX: vertical ? road + (i % 4 ? -54 : 54) : along, homeY: vertical ? along : road + (i % 4 ? 54 : -54), color: COLORS[i % COLORS.length], pace: 15 + this._random() * 12 });
      }
      this.police.push({ id: 'police-' + this._nextId++, x: 1260, y: 180, angle: Math.PI / 2, speed: 0, route: [{ x: 1260, y: 540 }], routeTimer: 4, lastSeen: { x: 900, y: 1080 } });
    }

    _addCar(x, y, angle, kind, color, traffic = false) {
      const car = { id: 'car-' + this._nextId++, x, y, angle, speed: 0, health: this.maxHealth, color, kind, traffic, vx: 0, vy: 0, borrowed: false, route: [] };
      this.cars.push(car);
      return car;
    }

    _isFree(x, y, radius = 10) {
      if (x < radius || y < radius || x > SIZE - radius || y > SIZE - radius) return false;
      return !this.buildings.some(b => Math.hypot(x - clamp(x, b.x, b.x + b.w), y - clamp(y, b.y, b.y + b.h)) < radius);
    }

    _vehicles() { return this.cars.concat(this.police); }

    _vehicleBox(entity) {
      const type = CAR_TYPES[entity.kind] || CAR_TYPES.compact;
      return orientedBox(entity, type.length, type.width);
    }

    _vehicleContact(a, b) {
      const ta = CAR_TYPES[a.kind] || CAR_TYPES.compact, tb = CAR_TYPES[b.kind] || CAR_TYPES.compact;
      const reach = (Math.hypot(ta.length, ta.width) + Math.hypot(tb.length, tb.width)) / 2;
      if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > reach * reach) return null;
      return boxContact(this._vehicleBox(a), this._vehicleBox(b));
    }

    _vehicleFree(entity) {
      const box = this._vehicleBox(entity);
      const ex = Math.abs(box.axes[0].x) * box.half[0] + Math.abs(box.axes[1].x) * box.half[1];
      const ey = Math.abs(box.axes[0].y) * box.half[0] + Math.abs(box.axes[1].y) * box.half[1];
      return entity.x >= ex && entity.x <= SIZE - ex && entity.y >= ey && entity.y <= SIZE - ey &&
        !this.buildings.some(b => boxContact(box, orientedBox({ x: b.x + b.w / 2, y: b.y + b.h / 2, angle: 0 }, b.w, b.h)));
    }

    _personVehicleContact(person, vehicle, radius = person === this.player ? 10 : 7) {
      const type = CAR_TYPES[vehicle.kind] || CAR_TYPES.compact;
      const reach = Math.hypot(type.length, type.width) / 2 + radius;
      if ((person.x - vehicle.x) ** 2 + (person.y - vehicle.y) ** 2 > reach * reach) return null;
      const box = this._vehicleBox(vehicle), dx = person.x - box.x, dy = person.y - box.y;
      const u = dx * box.axes[0].x + dy * box.axes[0].y, v = dx * box.axes[1].x + dy * box.axes[1].y;
      const cu = clamp(u, -box.half[0], box.half[0]), cv = clamp(v, -box.half[1], box.half[1]);
      const rx = u - cu, ry = v - cv, d = Math.hypot(rx, ry);
      if (d >= radius) return null;
      let nx, ny, depth;
      if (d > 0.0001) { nx = rx / d; ny = ry / d; depth = radius - d; }
      else {
        const ex = box.half[0] - Math.abs(u), ey = box.half[1] - Math.abs(v);
        if (ex < ey) { nx = u < 0 ? -1 : 1; ny = 0; depth = ex + radius; }
        else { nx = 0; ny = v < 0 ? -1 : 1; depth = ey + radius; }
      }
      return { nx: nx * box.axes[0].x + ny * box.axes[1].x, ny: nx * box.axes[0].y + ny * box.axes[1].y, depth };
    }

    _standingPeople() {
      const people = this.player.vehicleId ? this.peds : [this.player].concat(this.peds);
      return people.filter(person => !this.ragdolls.get(person.id));
    }

    _personFree(x, y, radius = 10, ignore = null) {
      const point = { x, y };
      return this._isFree(x, y, radius) && !this._vehicles().some(car => car !== ignore && this._personVehicleContact(point, car, radius));
    }

    _resolvePerson(entity, radius) {
      let collision = false;
      const vehicles = this._vehicles(), people = this._standingPeople();
      for (let pass = 0; pass < 4; pass++) {
        let changed = this._moveCircleBuildings(entity, 0, 0, radius);
        collision = changed || collision;
        for (const vehicle of vehicles) {
          const hit = this._personVehicleContact(entity, vehicle, radius);
          if (!hit) continue;
          entity.x += hit.nx * (hit.depth + 0.001); entity.y += hit.ny * (hit.depth + 0.001); changed = collision = true;
        }
        for (const other of people) {
          if (other === entity) continue;
          const otherRadius = other === this.player ? 10 : 7;
          const dx = entity.x - other.x, dy = entity.y - other.y, d = Math.hypot(dx, dy), depth = radius + otherRadius - d;
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
        const x = clamp(entity.x, ex, SIZE - ex), y = clamp(entity.y, ey, SIZE - ey);
        if (x !== entity.x || y !== entity.y) { entity.x = x; entity.y = y; changed = collided = true; }
        for (const b of this.buildings) {
          if (entity.x + ex <= b.x || entity.x - ex >= b.x + b.w || entity.y + ey <= b.y || entity.y - ey >= b.y + b.h) continue;
          const rect = orientedBox({ x: b.x + b.w / 2, y: b.y + b.h / 2, angle: 0 }, b.w, b.h);
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
      const speed = Math.hypot(velocityX, velocityY);
      for (const person of this._standingPeople()) {
        const hit = this._personVehicleContact(person, entity);
        if (!hit) continue;
        person.x += hit.nx * (hit.depth + 0.002); person.y += hit.ny * (hit.depth + 0.002);
        this._moveCircleBuildings(person, 0, 0, person === this.player ? 10 : 7);
        if (speed > 35 && !(person.ragdollGrace > 0) && (person !== this.player || this.graceTimer <= 0)) {
          const kick = clamp(speed / 20 * 0.58 + 1.2, 2.5, 11);
          this._knockDown(person, { x: velocityX / speed * kick, y: clamp(2.1 + speed / 200, 2.1, 4.5), z: velocityY / speed * kick });
          entity.speed *= 0.90;
          if (entity.id === this.player.vehicleId) this._raiseHeat(1, 'A resident took a confetti tumble. The Fun Police noticed!');
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
      entity.x = clamp(entity.x + dx, radius, SIZE - radius);
      entity.y = clamp(entity.y + dy, radius, SIZE - radius);
      let collision = entity.x !== oldX + dx || entity.y !== oldY + dy;
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (const b of this.buildings) {
          if (entity.x + radius <= b.x || entity.x - radius >= b.x + b.w || entity.y + radius <= b.y || entity.y - radius >= b.y + b.h) continue;
          const nx = clamp(entity.x, b.x, b.x + b.w), ny = clamp(entity.y, b.y, b.y + b.h);
          const rx = entity.x - nx, ry = entity.y - ny, d = Math.hypot(rx, ry);
          if (d >= radius) continue;
          changed = collision = true;
          if (d > 0.001) { entity.x = nx + rx / d * radius; entity.y = ny + ry / d * radius; }
          else {
            const edges = [{ amount: entity.x - b.x, x: b.x - radius, y: entity.y }, { amount: b.x + b.w - entity.x, x: b.x + b.w + radius, y: entity.y }, { amount: entity.y - b.y, x: entity.x, y: b.y - radius }, { amount: b.y + b.h - entity.y, x: entity.x, y: b.y + b.h + radius }];
            edges.sort((a, z) => a.amount - z.amount); entity.x = edges[0].x; entity.y = edges[0].y;
          }
        }
        if (!changed) break;
      }
      return collision;
    }

    _roadPosition(point) {
      const x = ROAD_CENTERS.reduce((a, b) => Math.abs(point.x - a) < Math.abs(point.x - b) ? a : b);
      const y = ROAD_CENTERS.reduce((a, b) => Math.abs(point.y - a) < Math.abs(point.y - b) ? a : b);
      return Math.abs(point.x - x) < Math.abs(point.y - y) ? { x, y: clamp(point.y, 180, 1980), axis: 'y' } : { x: clamp(point.x, 180, 1980), y, axis: 'x' };
    }

    _safeRoadPosition(point, radius = 18, ignore = null) {
      const road = this._roadPosition(point);
      const free = candidate => {
        if (ignore) {
          const vehicle = { ...ignore, ...candidate };
          return this._vehicleFree(vehicle) && !this._vehicles().some(other => other !== ignore && this._vehicleContact(vehicle, other));
        }
        return this._personFree(candidate.x, candidate.y, radius);
      };
      for (const offset of [0, 60, -60, 120, -120, 180, -180, 240, -240]) {
        const candidate = { x: road.x + (road.axis === 'x' ? offset : 0), y: road.y + (road.axis === 'y' ? offset : 0) };
        if (free(candidate)) return candidate;
      }
      for (const x of ROAD_CENTERS) for (const y of ROAD_CENTERS) if (free({ x, y })) return { x, y };
      return { x: road.x, y: road.y };
    }

    _nearestNode(point) {
      const nearest = value => ROAD_CENTERS.reduce((a, b) => Math.abs(value - a) < Math.abs(value - b) ? a : b);
      return { x: nearest(point.x), y: nearest(point.y) };
    }

    _roadRoute(from, to) {
      const start = this._roadPosition(from), finish = this._roadPosition(to);
      const candidates = p => ROAD_CENTERS.map(n => p.axis === 'x' ? { x: n, y: p.y } : { x: p.x, y: n });
      let best = null;
      for (const a of candidates(start)) for (const b of candidates(finish)) {
        const cost = distance(start, a) + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + distance(b, finish);
        if (!best || cost < best.cost) best = { a, b, cost };
      }
      const route = [], add = p => { if (!route.length || distance(route[route.length - 1], p) > 1) route.push({ x: p.x, y: p.y }); };
      add(start); add(best.a);
      let x = best.a.x, y = best.a.y;
      while (x !== best.b.x) { x += Math.sign(best.b.x - x) * 360; add({ x, y }); }
      while (y !== best.b.y) { y += Math.sign(best.b.y - y) * 360; add({ x, y }); }
      add(finish);
      while (route.length > 1 && distance(from, route[0]) < 25) route.shift();
      return route;
    }

    _wanderRoute(car) {
      const node = this._nearestNode(car), previous = car.previousNode;
      let options = [[360, 0], [-360, 0], [0, 360], [0, -360]].map(([dx, dy]) => ({ x: node.x + dx, y: node.y + dy })).filter(p => p.x >= 180 && p.y >= 180 && p.x <= 1980 && p.y <= 1980);
      const forward = options.filter(p => !previous || distance(previous, p) > 10);
      if (forward.length) options = forward;
      car.previousNode = node;
      const next = this._pick(options), heading = Math.atan2(next.y - node.y, next.x - node.x);
      return [{ x: next.x - Math.sin(heading) * 20, y: next.y + Math.cos(heading) * 20 }];
    }

    _confetti(x, y, count = 22, height) {
      for (let i = 0; i < count && this.particles.length < 360; i++) {
        const angle = this._random() * Math.PI * 2, speed = 30 + this._random() * 150, life = 0.5 + this._random() * 0.8;
        const particle = { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color: this._pick(COLORS), size: 3 + this._random() * 4 };
        if (Number.isFinite(height)) particle.height = Math.max(0.12, height);
        this.particles.push(particle);
      }
    }

    _raiseHeat(amount = 1, reason = 'The Fun Police noticed!') {
      this.escapeTimer = 0;
      if (this._troubleCooldown > 0) return;
      const before = this.heat;
      this.heat = clamp(this.heat + amount, 0, 3);
      this.police.forEach(cop => { cop.lastSeen = { x: this.current.x, y: this.current.y }; cop.routeTimer = 0; });
      this._troubleCooldown = 3;
      if (this.heat !== before) { this._toast(reason, 'warning'); this._sound('heat'); }
    }

    interact() {
      if (this.ragdolls.get(this.player.id)) return false;
      if (this.player.vehicleId) {
        const car = this.current;
        if (Math.abs(car.speed) > 45) { this._toast('Slow down before hopping out.'); return false; }
        const wash = this.services.find(s => s.id === 'wash' && distance(s, car) < 85);
        if (wash && (this.heat > 0 || car.health < this.maxHealth)) return this._useService(wash);
        return this._exitCar(car);
      }
      const nearby = this.cars.filter(car => car.health > 0 && distance(car, this.player) < 75 && Math.abs(car.speed) < 110).sort((a, b) => distance(a, this.player) - distance(b, this.player));
      if (nearby.length) {
        const car = nearby[0];
        this.player.vehicleId = car.id;
        car.traffic = false;
        car.speed = car.vx = car.vy = 0;
        this.player.x = car.x; this.player.y = car.y;
        if (!car.borrowed) { car.borrowed = true; this._raiseHeat(1, 'Borrowed a ride! The Fun Police are mildly interested.'); }
        this._toast('Nice wheels. Hold Shift for boost; Space for handbrake.'); this._sound('enter');
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
        if (this._personFree(x, y, 10)) {
          this.player.vehicleId = null; this.player.x = x; this.player.y = y; this.player.angle = car.angle;
          car.speed = car.vx = car.vy = 0;
          this._sound('exit'); return true;
        }
      }
      if (forced) {
        const position = this._safeRoadPosition(car, 10); this.player.vehicleId = null; this.player.x = position.x; this.player.y = position.y;
        return true;
      }
      this._toast('A little more room to hop out, please.'); return false;
    }

    _useService(service) {
      if (service.id === 'garage') { this._toast('Sprinkle Garage: press G for your car collection, or I for toys and pocket supplies.'); return true; }
      if (this.heat === 0 && (!this.player.vehicleId || this.current.health >= this.maxHealth)) { this._toast('Already sparkling clean!'); return false; }
      if (this.money < 75) { this._toast('The wash costs $75. Finish a gig for cash.', 'warning'); return false; }
      this.money -= 75; this.heat = 0; this.escapeTimer = 0; this.player.composure = 100;
      if (this.player.vehicleId) this.current.health = this.maxHealth;
      this._confetti(this.current.x, this.current.y, 36); this._toast('Squeaky clean: heat cleared and car repaired!', 'success'); this._sound('purchase');
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
      const aimHeight = range => 1.15 + Math.tan(pitch) * range / 20;
      const inAimHeight = person => {
        if (!aimed) return true;
        const dx = person.x - this.player.x, dy = person.y - this.player.y;
        const forward = dx * Math.cos(angle) + dy * Math.sin(angle);
        const height = aimHeight(Math.hypot(dx, dy));
        return forward >= 0 && height >= 0.1 && height <= 2.05 &&
          !this.buildings.some(building => segmentHitsRect(this.player, person, building));
      };
      const equipped = this.inventory.equipped;
      if (equipped === 'cannon' && this.inventory.ammo.cannon <= 0) { this._toast('Party Cannon is empty. Use a Party Refill from your pockets.'); return false; }
      this._actionCooldown = GADGETS[equipped].cooldown;
      if (equipped === 'cannon') {
        this.inventory.ammo.cannon--;
        const life = 360 / 560;
        const projectile = { id: 'party-' + this._nextId++, x: this.player.x + Math.cos(angle) * 25 * cosPitch, y: this.player.y + Math.sin(angle) * 25 * cosPitch, angle, height: 1.15, life, maxLife: life };
        if (aimed) Object.assign(projectile, { aimed: true, startHeight: Math.max(0.15, 1.15 + sinPitch * 1.25), horizontalSpeed: 560 * cosPitch, verticalSpeed: 28 * sinPitch });
        if (aimed) projectile.height = projectile.startHeight;
        this.projectiles.push(projectile);
        this._confetti(this.player.x, this.player.y, 8); this._sound('pop');
        return true;
      }
      if (equipped === 'hammer') {
        const reach = 62, forwardX = Math.cos(angle), forwardY = Math.sin(angle);
        this._confetti(this.player.x + forwardX * 35 * cosPitch, this.player.y + forwardY * 35 * cosPitch, 18, aimed ? 1.15 + sinPitch * 1.75 : undefined); this._sound('hammer');
        let hit = false;
        const inReach = person => {
          const dx = person.x - this.player.x, dy = person.y - this.player.y, range = Math.hypot(dx, dy);
          return range < reach && inAimHeight(person) && (range < 1 || (dx * forwardX + dy * forwardY) / range > 0.5) &&
            !this.buildings.some(building => segmentHitsRect(this.player, person, building));
        };
        for (const ped of this.peds) if (ped.stunned <= 0 && inReach(ped)) {
          hit = this._knockDown(ped, { x: forwardX * 5.8, y: 3.2, z: forwardY * 5.8 }) || hit;
        }
        for (const cop of this.police) if (inReach(cop)) { cop.distracted = 2.3; this._confetti(cop.x, cop.y, 25); hit = true; }
        if (hit) this._raiseHeat(1, 'Inflatable nuisance! The Fun Police heard that bonk.');
        return true;
      }
      const pop = { x: this.player.x + Math.cos(angle) * 44 * cosPitch, y: this.player.y + Math.sin(angle) * 44 * cosPitch };
      this._confetti(pop.x, pop.y, 25, aimed ? 1.15 + sinPitch * 2.2 : undefined); this._sound('pop');
      let hit = false;
      for (const ped of this.peds) if (ped.stunned <= 0 && !this.ragdolls.get(ped.id) && inAimHeight(ped) && distance(ped, pop) < 60) { this._startle(ped, angle); hit = true; }
      for (const cop of this.police) if (inAimHeight(cop) && distance(cop, pop) < 65) { cop.distracted = 1.8; hit = true; this._confetti(cop.x, cop.y, 20); }
      if (hit) this._raiseHeat(1, 'Confetti disturbance! Find a corner to hide.');
      return true;
    }

    _burstParty(projectile) {
      this._confetti(projectile.x, projectile.y, 85, projectile.aimed ? projectile.height : undefined); this._sound('party');
      if (projectile.aimed && projectile.height > 2.6) return;
      let hit = false;
      for (const ped of this.peds) if (ped.stunned <= 0 && distance(ped, projectile) < 85 &&
        !this.buildings.some(building => segmentHitsRect(projectile, ped, building))) {
        const angle = distance(ped, projectile) > 1 ? Math.atan2(ped.y - projectile.y, ped.x - projectile.x) : projectile.angle;
        hit = this._knockDown(ped, { x: Math.cos(angle) * 4.8, y: 3.8, z: Math.sin(angle) * 4.8 }) || hit;
      }
      for (const cop of this.police) if (distance(cop, projectile) < 90) { cop.distracted = 3; this._confetti(cop.x, cop.y, 25); hit = true; }
      if (hit) this._raiseHeat(1, 'Party Cannon commotion! That was a very loud celebration.');
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
          projectile.height = projectile.aimed ? projectile.startHeight + projectile.verticalSpeed * elapsed - 2 * elapsed * elapsed : 1.15 + Math.sin(Math.PI * (1 - projectile.life / projectile.maxLife)) * 1.1;
          const atHeight = height => !projectile.aimed || Math.min(before.height, projectile.height) <= height && Math.max(before.height, projectile.height) >= 0.1;
          const walls = this.buildings.some(b => atHeight(finite(b.height, 8)) && segmentHitsRect(before, projectile, { x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 }));
          const vehicles = this._vehicles().some(vehicle => {
            if (!atHeight(vehicle.kind === 'van' ? 2.6 : 1.8)) return false;
            const box = this._vehicleBox(vehicle);
            const local = point => ({ x: (point.x - vehicle.x) * box.axes[0].x + (point.y - vehicle.y) * box.axes[0].y, y: (point.x - vehicle.x) * box.axes[1].x + (point.y - vehicle.y) * box.axes[1].y });
            return segmentHitsRect(local(before), local(projectile), { x: -box.half[0] - 3, y: -box.half[1] - 3, w: box.half[0] * 2 + 6, h: box.half[1] * 2 + 6 });
          });
          const people = atHeight(2.05) && this.peds.some(ped => ped.stunned <= 0 && distance(ped, projectile) < 16);
          const ground = projectile.aimed && projectile.height <= 0.12;
          if (ground) projectile.height = 0.12;
          burst = walls || vehicles || people || ground || projectile.life <= 0.000001 || projectile.x < 0 || projectile.y < 0 || projectile.x > SIZE || projectile.y > SIZE;
        }
        if (burst) this._burstParty(projectile); else remaining.push(projectile);
      }
      this.projectiles = remaining;
    }

    horn() {
      if (!this.player.vehicleId) { this._toast('The parade needs a car. Borrow one and honk!'); return false; }
      if (this._hornCooldown > 0) return false;
      this._hornCooldown = 0.55; this._sound('horn');
      const car = this.current;
      this.peds.filter(p => distance(p, car) < 100 && p.stunned <= 0).forEach(p => { p.bubble = this._pick(['TOOT TOOT!', 'NICE HORN!', 'OH, CRUMBS!']); p.bubbleTimer = 2; });
      if (this.mission && this.mission.type === 'party') {
        const target = this.mission.targets[this.mission.targetIndex];
        if (distance(car, target) < 95 && Math.abs(car.speed) < 65) {
          this._confetti(target.x, target.y, 65); this._raiseHeat(1, 'That party is loud enough to attract the Fun Police!'); this._advanceMission(); return true;
        }
        if (distance(car, target) < 130) this._toast('Slow down, then honk inside the party ring.');
      }
      return true;
    }

    _knockDown(person, impulse) {
      if (this.ragdolls.get(person.id) || person.ragdollGrace > 0) return false;
      const body = this.ragdolls.trigger(person, impulse);
      if (!body) return false;
      person.stunned = 3.8; person.bubble = this._pick(CURSES); person.bubbleTimer = 3;
      this._confetti(person.x, person.y, 32); this._sound('flop');
      if (person === this.player) this._toast(person.bubble + ' Getting back up…');
      return true;
    }

    _startle(ped, angle = this.player.angle) {
      return this._knockDown(ped, { x: Math.cos(angle) * 3.5, y: 2.5, z: Math.sin(angle) * 3.5 });
    }

    flop() {
      if (this.player.vehicleId || this.ragdolls.get(this.player.id) || this.player.ragdollGrace > 0) return false;
      return this._knockDown(this.player, { x: Math.cos(this.player.angle) * 2.2, y: 2.2, z: Math.sin(this.player.angle) * 2.2 });
    }

    recover() {
      this.ragdolls.clear(this.player.id);
      this.player.stunned = 0; this.player.ragdollGrace = 1.4;
      const entity = this.current, p = this._safeRoadPosition(entity, this.player.vehicleId ? 18 : 10, this.player.vehicleId ? entity : null);
      entity.x = p.x; entity.y = p.y;
      if (this.player.vehicleId) { entity.speed = entity.vx = entity.vy = 0; entity.health = Math.max(25, entity.health); }
      this.player.x = p.x; this.player.y = p.y; this.player.composure = Math.max(60, this.player.composure);
      this.graceTimer = 2; this.score = Math.max(0, this.score - 20);
      this._toast('Unstuck! Back on the road. −20 style; your cash is safe.'); this._confetti(p.x, p.y, 22);
      return true;
    }

    _caught() {
      this.ragdolls.clear(this.player.id);
      this.player.stunned = 0; this.player.ragdollGrace = 1.4;
      const car = this.player.vehicleId ? this.current : null;
      if (car) { car.speed = car.vx = car.vy = 0; this._exitCar(car, true); }
      this.player.vehicleId = null; this.player.x = 884; this.player.y = 1080; this.player.composure = 100;
      this.money = Math.max(0, this.money - 50); this.heat = 0; this.escapeTimer = 0; this.graceTimer = 3;
      this._toast('BUSTED-ISH! $50 cleanup fee. Back to the fun—your gig is still active.', 'warning'); this._sound('busted'); this._confetti(884, 1080, 45);
    }

    acceptMission(type) {
      if (this.mission) { this._toast('Finish or abandon your current gig first.'); return false; }
      const variation = this.completed % 2;
      const recipes = {
        delivery: { title: 'Emergency Disco', description: 'Collect the disco ball, then deliver it to the dance hall.', stage: 'pickup', targets: variation ? [{ x: 540, y: 1620 }, { x: 1980, y: 540 }] : [{ x: 900, y: 540 }, { x: 1980, y: 1620 }], totalTime: 80, reward: 140 },
        dash: { title: 'Lawn Enforcement Slalom', description: 'Drive through six gates in order. Late finish? You still get base pay.', stage: 'checkpoints', targets: [{ x: 900, y: 540 }, { x: 1620, y: 540 }, { x: 1620, y: 1260 }, { x: 540, y: 1260 }, { x: 540, y: 1980 }, { x: 1980, y: 1980 }], totalTime: 105, reward: 180 },
        party: { title: 'Operation Un-Boring', description: 'Drive to each party ring, slow down, and press H to honk.', stage: 'parties', targets: variation ? [{ x: 180, y: 900 }, { x: 1260, y: 540 }, { x: 1980, y: 1620 }] : [{ x: 540, y: 540 }, { x: 1620, y: 900 }, { x: 1260, y: 1980 }], totalTime: 110, reward: 200 }
      };
      const recipe = recipes[type];
      if (!recipe) { this._toast('Choose a delivery, dash, or party gig.'); return false; }
      this.mission = { type, ...recipe, targetIndex: 0, timeLeft: recipe.totalTime };
      this.missionStats = { elapsed: 0, collisions: 0, style: 0, overtime: false };
      this._toast(recipe.title + ': ' + recipe.description); this._sound('accept'); return true;
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
        const pay = mission.reward + timeBonus + cleanBonus + styleBonus;
        this.money = Math.min(999999, this.money + pay); this.completed++; this._addScore(100 + timeBonus);
        this._confetti(this.current.x, this.current.y, 90); this._toast('Gig complete! +$' + pay + ' (' + mission.reward + ' base + ' + (pay - mission.reward) + ' bonus).', 'success'); this._sound('complete');
        this.mission = null;
      } else {
        if (mission.type === 'delivery') mission.stage = 'dropoff';
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
      this.inventory.equipped = id;
      return true;
    }

    purchaseGadget(id) {
      if (!owns(GADGETS, id) || !this._requireGarage()) return false;
      if (this.inventory.unlocked.includes(id)) { this._toast('You already own the ' + GADGETS[id].name + '.'); return false; }
      const gadget = GADGETS[id];
      if (this.money < gadget.price) { this._toast('The ' + gadget.name + ' costs $' + gadget.price + '.', 'warning'); return false; }
      this.money -= gadget.price; this.inventory.unlocked.push(id); this.inventory.equipped = id;
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
        if (Math.abs(this.current.speed) > 45) { this._toast('Stop your car before applying Repair Tape.'); return false; }
        if (this.current.health >= this.maxHealth) { this._toast('This ride needs no tape.'); return false; }
        this.current.health = Math.min(this.maxHealth, this.current.health + 55);
        this._syncGarage();
      } else if (id === 'refill') {
        if (!this.inventory.unlocked.includes('cannon')) { this._toast('Unlock the Party Cannon before using a refill.'); return false; }
        if (this.inventory.ammo.cannon >= 12) { this._toast('Party Cannon is already fully stocked.'); return false; }
        this.inventory.ammo.cannon = Math.min(12, this.inventory.ammo.cannon + 6);
      }
      this.inventory.pockets[id]--;
      this._toast(POCKET_ITEMS[id].name + ' used. Lovely stuff.', 'success'); this._sound('consume'); return true;
    }

    _syncGarage() {
      for (const record of this.garage.cars) {
        const deployed = this.cars.find(car => car.garageId === record.id);
        if (deployed) { record.health = clamp(finite(deployed.health, 0), 0, this.maxHealth); record.color = deployed.color; }
      }
    }

    garageStore() {
      if (!this._requireGarage()) return false;
      if (!this.player.vehicleId || !this.cars.includes(this.current)) { this._toast('Drive a civilian car here to save it in your collection.'); return false; }
      const car = this.current;
      if (car.health <= 0) { this._toast('Repair this ride before adding it to your collection.'); return false; }
      if (car.garageId && this.garage.cars.some(record => record.id === car.garageId)) { this._syncGarage(); this._toast('This ride is already in your collection.'); return false; }
      if (this.garage.cars.length >= 3) { this._toast('Your three garage spaces are full.'); return false; }
      let number = 1;
      while (this.garage.cars.some(record => record.id === 'ride-' + number)) number++;
      const record = { id: 'ride-' + number, kind: car.kind, color: car.color, health: car.health };
      this.garage.cars.push(record); car.garageId = record.id; car.borrowed = true;
      this._toast(CAR_TYPES[car.kind].name + ' saved! Your collection survives reloads.', 'success'); this._sound('purchase'); return true;
    }

    garageRetrieve(id) {
      if (!this._requireGarage()) return false;
      this._syncGarage();
      const record = this.garage.cars.find(car => car.id === id);
      if (!record) return false;
      if (record.health <= 0) { this._toast('This ride is wrecked. Repair it in your collection before retrieving it.'); return false; }
      const deployed = this.cars.find(car => car.garageId === id);
      const garage = this.services.find(service => service.id === 'garage');
      const preview = { id: deployed ? deployed.id : '', kind: record.kind, angle: -Math.PI / 2, x: garage.x, y: garage.y };
      let position = null;
      // All retrieval pads stay within walking distance of the service. Check
      // the full rotated body against walls, cars, and pedestrians before moving it.
      for (const dy of [0, -60, 60, -100, 100]) for (const dx of [0, -20, 20, -60, 60, -100, 100]) {
        if (position || Math.hypot(dx, dy) >= 110) continue;
        const candidate = { ...preview, x: garage.x + dx, y: garage.y + dy };
        if (this._vehicleFree(candidate) && !this._vehicles().some(other => other !== deployed && this._vehicleContact(candidate, other)) &&
          !this.peds.some(ped => this._personVehicleContact(ped, candidate, 9))) position = candidate;
      }
      if (!position) { this._toast('Garage exit is crowded. Clear a little space and try again.'); return false; }
      if (this.player.vehicleId) { this.current.speed = this.current.vx = this.current.vy = 0; this.current.traffic = false; }
      const car = deployed || this._addCar(position.x, position.y, position.angle, record.kind, record.color);
      car.x = position.x; car.y = position.y; car.angle = position.angle;
      car.health = record.health; car.color = record.color; car.garageId = record.id;
      car.speed = car.vx = car.vy = 0; car.traffic = false; car.borrowed = true;
      this.player.vehicleId = car.id; this.player.x = car.x; this.player.y = car.y; this.player.angle = car.angle;
      this._toast(CAR_TYPES[record.kind].name + ' retrieved. Ready for a spin!', 'success'); this._sound('enter'); return true;
    }

    garageRepair(id) {
      if (!this._requireGarage()) return false;
      this._syncGarage();
      const record = this.garage.cars.find(car => car.id === id);
      if (!record) return false;
      if (record.health >= this.maxHealth) { this._toast('This collected ride is already in perfect condition.'); return false; }
      if (this.money < 45) { this._toast('A garage repair costs $45.', 'warning'); return false; }
      this.money -= 45; record.health = this.maxHealth;
      this.cars.filter(car => car.garageId === record.id).forEach(car => { car.health = this.maxHealth; });
      this._toast('Collected ride fully repaired for $45. Ready to retrieve!', 'success'); this._sound('purchase'); return true;
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
      this._toast('Fresh sprinkles! New paint applied for $25.', 'success'); this._sound('purchase'); return true;
    }

    purchase(item) {
      if (!['repair', 'boost', 'armor'].includes(item)) return false;
      if (!this._requireGarage()) return false;
      if (item === 'repair') {
        if (!this.player.vehicleId) { this._toast('Hop in a car before buying a repair.'); return false; }
        if (this.current.health >= this.maxHealth) { this._toast('This ride is already in perfect condition.'); return false; }
        if (this.money < 45) { this._toast('A repair costs $45.', 'warning'); return false; }
        this.money -= 45; this.current.health = this.maxHealth;
      } else if (item === 'boost' || item === 'armor') {
        const level = this.upgrades[item], price = item === 'boost' ? 200 + level * 150 : 150 + level * 125;
        if (level >= 3) { this._toast('That upgrade is already maxed out.'); return false; }
        if (this.money < price) { this._toast('You need $' + price + ' for this upgrade.', 'warning'); return false; }
        this._syncGarage();
        this.money -= price; this.upgrades[item]++;
        if (item === 'armor') {
          this.cars.forEach(car => { if (car.health > 0) car.health = Math.min(this.maxHealth, car.health + 25); });
          this.garage.cars.forEach(record => { if (record.health > 0 && !this.cars.some(car => car.garageId === record.id)) record.health = Math.min(this.maxHealth, record.health + 25); });
        }
      } else return false;
      this._syncGarage();
      this._toast(item === 'repair' ? 'Fresh wheels! Car fully repaired.' : item + ' upgraded to level ' + this.upgrades[item] + '!', 'success'); this._sound('purchase'); return true;
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
      if (this.player.vehicleId) this._drive(this.current, dt, input); else this._walk(dt, input);
      for (const car of this.cars) if (car.traffic && car.health > 0 && car.id !== this.player.vehicleId) this._traffic(car, dt);
      this._pedestrians(dt);
      this._updatePolice(dt);
      this._projectiles(dt);
      const finished = this.ragdolls.step(dt, { buildings: this.buildings, cars: this.cars, police: this.police, size: SIZE });
      for (const body of finished) {
        const owner = body.owner;
        owner.stunned = 0; owner.ragdollGrace = 1.4;
        if (owner !== this.player) owner.angle = Math.atan2(owner.homeY - owner.y, owner.homeX - owner.x);
        this._resolvePerson(owner, owner === this.player ? 10 : 7);
      }
      if (this.mission) {
        this.missionStats.elapsed += dt;
        this.mission.timeLeft = Math.max(0, this.mission.timeLeft - dt);
        if (this.mission.timeLeft === 0 && !this.missionStats.overtime) { this.missionStats.overtime = true; this._toast('Overtime! Finish the gig anyway; base pay is safe.'); }
        const target = this.mission.targets[this.mission.targetIndex];
        if (!this.ragdolls.get(this.player.id) && this.mission.type !== 'party' && (this.mission.type !== 'dash' || this.player.vehicleId) && distance(this.current, target) < 58) this._advanceMission();
      }
      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-2 * dt); p.vy = p.vy * Math.exp(-2 * dt) + 18 * dt; }
      this.particles = this.particles.filter(p => p.life > 0);
      this.skidMarks.forEach(mark => { mark.life -= dt; }); this.skidMarks = this.skidMarks.filter(mark => mark.life > 0).slice(-250);
    }

    _walk(dt, input) {
      if (this.ragdolls.get(this.player.id)) return;
      const forward = Number(Boolean(input.up)) - Number(Boolean(input.down));
      const strafe = Number(Boolean(input.right)) - Number(Boolean(input.left));
      let x = strafe, y = -forward;
      if (Number.isFinite(input.moveAngle)) {
        x = forward * Math.cos(input.moveAngle) + strafe * Math.cos(input.moveAngle + Math.PI / 2);
        y = forward * Math.sin(input.moveAngle) + strafe * Math.sin(input.moveAngle + Math.PI / 2);
      }
      const length = Math.hypot(x, y);
      if (length) { x /= length; y /= length; this.player.angle = Math.atan2(y, x); this._move(this.player, x * (input.boost ? 220 : 155) * dt, y * (input.boost ? 220 : 155) * dt, 10); }
    }

    _drive(car, dt, input) {
      const type = CAR_TYPES[car.kind] || CAR_TYPES.compact;
      const max = type.maxSpeed * (input.boost ? 1.2 + this.upgrades.boost * 0.075 : 1);
      if (input.up) car.speed += type.acceleration * (input.boost ? 1.3 : 1) * dt;
      if (input.down) car.speed -= (car.speed > 15 ? 700 : 260) * dt;
      if (!input.up && !input.down) car.speed *= Math.exp(-1.1 * dt);
      if (input.brake) car.speed *= Math.exp(-3.8 * dt);
      car.speed = clamp(car.speed, -110, max);
      if (Math.abs(car.speed) < 1) car.speed = 0;
      const steer = Number(Boolean(input.right)) - Number(Boolean(input.left));
      if (Math.abs(car.speed) > 3) car.angle = wrapAngle(car.angle + steer * type.handling * clamp(Math.abs(car.speed) / 150, 0.2, 1) * (input.brake ? 1.5 : 1) * Math.sign(car.speed) * dt);
      const grip = 1 - Math.exp(-(input.brake ? 3 : type.grip) * dt);
      car.vx += (Math.cos(car.angle) * car.speed - car.vx) * grip;
      car.vy += (Math.sin(car.angle) * car.speed - car.vy) * grip;
      const impact = Math.hypot(car.vx, car.vy);
      const contact = this._moveVehicle(car, car.vx * dt, car.vy * dt, car.vx, car.vy);
      if (contact.collided) this._impact(car, impact, contact.vehicle);
      for (const other of this.cars) {
        if (other === car || other.health <= 0) continue;
        const d = distance(car, other);
        if (!contact.collided && d < 70 && !this._vehicleContact(car, other) && impact > 170 && this.time - (this._nearMisses.get(other.id) ?? -20) > 14) {
          this._nearMisses.set(other.id, this.time); this._style(8, 'Close shave!');
        }
      }
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

    _impact(car, speed, traffic) {
      car.speed *= -0.24; car.vx *= -0.2; car.vy *= -0.2;
      if (this._impactCooldown > 0 || this.graceTimer > 0) return;
      this._impactCooldown = 0.6;
      if (speed > 65) {
        car.health -= (speed - 50) * 0.11 / ((CAR_TYPES[car.kind] || CAR_TYPES.compact).mass * (1 + this.upgrades.armor * 0.1));
        this._confetti(car.x, car.y, 16); this._sound('crash');
        if (this.mission) this.missionStats.collisions++;
        if (traffic && speed > 140) this._raiseHeat(1, 'Whoops! The Fun Police heard that bumper bonk.');
      }
      if (car.health <= 0) {
        car.health = 0; car.traffic = false; this._confetti(car.x, car.y, 75); this._exitCar(car, true); this.graceTimer = 2;
        this._toast('Your ride popped! Borrow another, or press R to recover.', 'warning');
      }
    }

    _traffic(car, dt) {
      if (!car.route || !car.route.length) car.route = this._wanderRoute(car);
      let target = car.route[0];
      if (distance(car, target) < 12) { car.route = this._wanderRoute(car); target = car.route[0]; }
      const angle = Math.atan2(target.y - car.y, target.x - car.x), desired = distance(car, target) < 75 ? 55 : 100;
      let speed = desired;
      if (this._vehicles().some(other => other !== car && distance(other, car) < 68 && Math.abs(wrapAngle(Math.atan2(other.y - car.y, other.x - car.x) - angle)) < 0.7)) speed = 8;
      car.speed += (speed - car.speed) * Math.min(1, dt * 4); car.angle = angle;
      for (const other of this._vehicles()) if (other !== car && distance(other, car) < 75 && Math.abs(wrapAngle(Math.atan2(other.y - car.y, other.x - car.x) - angle)) < 0.7) {
        const type = CAR_TYPES[car.kind] || CAR_TYPES.compact, otherType = CAR_TYPES[other.kind] || CAR_TYPES.compact;
        const gap = (type.length + otherType.length) / 2 + 4;
        car.speed = Math.min(car.speed, Math.max(0, distance(other, car) - gap) / dt);
      }
      const oldX = car.x, oldY = car.y, vx = Math.cos(angle) * car.speed, vy = Math.sin(angle) * car.speed;
      const hit = this._moveVehicle(car, vx * dt, vy * dt, vx, vy);
      car.vx = (car.x - oldX) / dt; car.vy = (car.y - oldY) / dt;
      if (hit.collided) { car.speed = 0; car.blockedTime = (car.blockedTime || 0) + dt; }
      else car.blockedTime = Math.max(0, (car.blockedTime || 0) - dt);
      if (car.blockedTime > 2.5) { car.route = this._wanderRoute(car); car.blockedTime = 0; }
    }

    _pedestrians(dt) {
      for (const ped of this.peds) {
        ped.ragdollGrace = Math.max(0, (ped.ragdollGrace || 0) - dt);
        ped.bubbleTimer = Math.max(0, ped.bubbleTimer - dt);
        if (!ped.bubbleTimer) ped.bubble = '';
        if (ped.stunned > 0 || this.ragdolls.get(ped.id)) { ped.stunned = Math.max(0, ped.stunned - dt); continue; }
        const dx = Math.cos(ped.angle) * ped.pace * dt, dy = Math.sin(ped.angle) * ped.pace * dt;
        if (distance(ped, { x: ped.homeX, y: ped.homeY }) > 85) ped.angle = Math.atan2(ped.homeY - ped.y, ped.homeX - ped.x);
        if (this._move(ped, dx, dy, 7)) ped.angle = wrapAngle(ped.angle + Math.PI * (0.65 + this._random() * 0.2));
      }
    }

    _updatePolice(dt) {
      const wanted = Math.max(1, this.heat);
      while (this.police.length < wanted) {
        const candidates = [];
        for (const x of ROAD_CENTERS) for (const y of ROAD_CENTERS) if (distance(this.current, { x, y }) > 440 && this.police.every(cop => distance(cop, { x, y }) > 120)) candidates.push({ x, y });
        candidates.sort((a, b) => Math.abs(distance(this.current, a) - 650) - Math.abs(distance(this.current, b) - 650));
        const point = candidates.length ? candidates[0] : { x: 180, y: 180 };
        this.police.push({ id: 'police-' + this._nextId++, ...point, angle: 0, speed: 0, route: [], routeTimer: 0, lastSeen: { x: this.current.x, y: this.current.y } });
      }
      if (this.police.length > wanted) this.police.length = wanted;
      let seen = false, contact = false;
      for (const cop of this.police) {
        cop.distracted = Math.max(0, (cop.distracted || 0) - dt);
        const sight = this.heat > 0 && cop.distracted <= 0 && this.graceTimer <= 0 && distance(cop, this.current) < 340 + this.heat * 65 && !this.buildings.some(b => segmentHitsRect(cop, this.current, b));
        if (sight) { seen = true; cop.lastSeen = { x: this.current.x, y: this.current.y }; }
        cop.routeTimer -= dt;
        if (cop.routeTimer <= 0 || !cop.route.length) {
          if (this.heat) cop.route = this._roadRoute(cop, cop.lastSeen);
          else cop.route = this._wanderRoute(cop);
          cop.routeTimer = this.heat ? 1.1 : 5;
        }
        const direct = sight && distance(cop, this.current) < 180;
        let target = direct ? this.current : cop.route[0];
        while (!direct && target && distance(cop, target) < 18 && cop.route.length > 1) { cop.route.shift(); target = cop.route[0]; }
        if (target && distance(cop, target) > 10 && cop.distracted <= 0) {
          cop.angle = Math.atan2(target.y - cop.y, target.x - cop.x);
          const desired = this.heat ? 160 + this.heat * 25 : 75;
          cop.speed += (desired - cop.speed) * Math.min(1, dt * 3);
          const oldX = cop.x, oldY = cop.y, vx = Math.cos(cop.angle) * cop.speed, vy = Math.sin(cop.angle) * cop.speed;
          const hit = this._moveVehicle(cop, vx * dt, vy * dt, vx, vy);
          cop.vx = (cop.x - oldX) / dt; cop.vy = (cop.y - oldY) / dt;
          if (hit.collided) { cop.routeTimer = 0; cop.speed *= 0.3; }
        } else { cop.speed *= Math.exp(-5 * dt); cop.vx = cop.vy = 0; }
        let close;
        if (this.player.vehicleId) { const box = this._vehicleBox(this.current); box.half = box.half.map(n => n + 5); close = boxContact(this._vehicleBox(cop), box); }
        else close = this._personVehicleContact(this.player, cop, 14);
        if (this.heat > 0 && this.graceTimer <= 0 && cop.distracted <= 0 && close) contact = true;
      }
      this.policeSeen = seen;
      if (this.heat > 0) {
        this.escapeTimer = seen ? 0 : this.escapeTimer + dt;
        if (this.escapeTimer >= this.escapeGoal) { this.heat = 0; this.escapeTimer = 0; this._toast('Fun Police escaped! Back to the biscuits.', 'success'); this._sound('escape'); this._addScore(25); }
      } else this.escapeTimer = 0;
      this.player.composure = clamp(this.player.composure + (contact ? -27 : 7) * dt, 0, 100);
      if (this.player.composure <= 0) this._caught();
    }

    exportSave() {
      this._syncGarage();
      return {
        version: 2, money: this.money, score: this.score, bestScore: this.bestScore, completed: this.completed, upgrades: { ...this.upgrades },
        inventory: { equipped: this.inventory.equipped, unlocked: this.inventory.unlocked.slice(), pockets: { ...this.inventory.pockets }, ammo: { ...this.inventory.ammo } },
        garage: { cars: this.garage.cars.map(car => ({ ...car })) }
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
      this.cars.forEach(car => { if (car.health > 0) car.health = clamp(car.health + (this.upgrades.armor - oldArmor) * 25, 0, this.maxHealth); });
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
        if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !/^ride-[1-9][0-9]{0,3}$/.test(record.id) ||
          cars.some(car => car.id === record.id) || !owns(CAR_TYPES, record.kind) || !COLORS.includes(record.color)) continue;
        cars.push({ id: record.id, kind: record.kind, color: record.color, health: clamp(finite(record.health, 0), 0, this.maxHealth) });
      }
      this.garage = { cars };
      const deployed = new Set();
      for (const car of this.cars) if (car.garageId) {
        const record = cars.find(saved => saved.id === car.garageId);
        if (record && !deployed.has(record.id) && record.kind === car.kind) {
          deployed.add(record.id); car.health = record.health; car.color = record.color;
        } else delete car.garageId;
      }
      return true;
    }
  }

  const api = { Game, SIZE, ROAD_CENTERS, ROAD_WIDTH, CAR_TYPES, GADGETS, POCKET_ITEMS, PAINT_COLORS: Object.freeze(COLORS.slice()) };
  root.MayhemCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
