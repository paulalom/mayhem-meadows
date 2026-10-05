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
  const CURSES = ['SON OF A BISCUIT!', 'HECKITY HECK!', 'FLIPPIN’ TURNIPS!', 'OH, CRUMBS!', 'YOU ABSOLUTE WAFFLE!'];
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const wrapAngle = n => Math.atan2(Math.sin(n), Math.cos(n));
  const finite = (n, fallback) => typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  const numeric = (n, fallback, min, max) => clamp(Math.floor(finite(n, fallback)), min, max);

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
      this.heat = 0;
      this.escapeTimer = 0;
      this.policeSeen = false;
      this.graceTimer = 2;
      this.mission = null;
      this.missionStats = { elapsed: 0, collisions: 0, style: 0, overtime: false };
      this.player = { x: 884, y: 1080, angle: -Math.PI / 2, vehicleId: null, composure: 100 };
      this.cars = [];
      this.peds = [];
      this.police = [];
      this.buildings = [];
      this.particles = [];
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
        this.buildings.push({ x, y, w: 240, h: 240, color: COLORS[(row + col * 2) % COLORS.length], name: names[(row * 5 + col) % names.length] });
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

    _move(entity, dx, dy, radius) {
      const oldX = entity.x, oldY = entity.y;
      entity.x = clamp(entity.x + dx, radius, SIZE - radius);
      entity.y = clamp(entity.y + dy, radius, SIZE - radius);
      let collision = entity.x !== oldX + dx || entity.y !== oldY + dy;
      for (let pass = 0; pass < 3; pass++) for (const b of this.buildings) {
        const nx = clamp(entity.x, b.x, b.x + b.w), ny = clamp(entity.y, b.y, b.y + b.h);
        const rx = entity.x - nx, ry = entity.y - ny, d = Math.hypot(rx, ry);
        if (d >= radius) continue;
        collision = true;
        if (d > 0.001) { entity.x = nx + rx / d * radius; entity.y = ny + ry / d * radius; }
        else {
          const edges = [{ amount: entity.x - b.x, x: b.x - radius, y: entity.y }, { amount: b.x + b.w - entity.x, x: b.x + b.w + radius, y: entity.y }, { amount: entity.y - b.y, x: entity.x, y: b.y - radius }, { amount: b.y + b.h - entity.y, x: entity.x, y: b.y + b.h + radius }];
          edges.sort((a, z) => a.amount - z.amount); entity.x = edges[0].x; entity.y = edges[0].y;
        }
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
      for (const offset of [0, 60, -60, 120, -120, 180, -180, 240, -240]) {
        const candidate = { x: road.x + (road.axis === 'x' ? offset : 0), y: road.y + (road.axis === 'y' ? offset : 0) };
        if (this._isFree(candidate.x, candidate.y, radius) && !this.cars.some(car => car !== ignore && car.health > 0 && distance(candidate, car) < radius + 23)) return candidate;
      }
      for (const x of ROAD_CENTERS) for (const y of ROAD_CENTERS) if (!this.cars.some(car => car !== ignore && car.health > 0 && distance({ x, y }, car) < radius + 23)) return { x, y };
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

    _confetti(x, y, count = 22) {
      for (let i = 0; i < count && this.particles.length < 360; i++) {
        const angle = this._random() * Math.PI * 2, speed = 30 + this._random() * 150, life = 0.5 + this._random() * 0.8;
        this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, maxLife: life, color: this._pick(COLORS), size: 3 + this._random() * 4 });
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
        if (this._isFree(x, y, 10) && !this.cars.some(other => other !== car && other.health > 0 && distance(other, { x, y }) < 28)) {
          this.player.vehicleId = null; this.player.x = x; this.player.y = y; this.player.angle = car.angle;
          car.speed = car.vx = car.vy = 0;
          this._sound('exit'); return true;
        }
      }
      if (forced) {
        const position = this._safeRoadPosition(car, 10, car); this.player.vehicleId = null; this.player.x = position.x; this.player.y = position.y;
        return true;
      }
      this._toast('A little more room to hop out, please.'); return false;
    }

    _useService(service) {
      if (service.id === 'garage') { this._toast('Garage: boost $200+, armor $150+, or repair $45. Use the upgrade buttons.'); return true; }
      if (this.heat === 0 && (!this.player.vehicleId || this.current.health >= this.maxHealth)) { this._toast('Already sparkling clean!'); return false; }
      if (this.money < 75) { this._toast('The wash costs $75. Finish a gig for cash.', 'warning'); return false; }
      this.money -= 75; this.heat = 0; this.escapeTimer = 0; this.player.composure = 100;
      if (this.player.vehicleId) this.current.health = this.maxHealth;
      this._confetti(this.current.x, this.current.y, 36); this._toast('Squeaky clean: heat cleared and car repaired!', 'success'); this._sound('purchase');
      return true;
    }

    action(angle = this.player.angle) {
      if (this.player.vehicleId || this._actionCooldown > 0) return false;
      angle = finite(angle, this.player.angle); this.player.angle = angle;
      this._actionCooldown = 0.55;
      const pop = { x: this.player.x + Math.cos(angle) * 44, y: this.player.y + Math.sin(angle) * 44 };
      this._confetti(pop.x, pop.y, 25); this._sound('pop');
      let hit = false;
      for (const ped of this.peds) if (ped.stunned <= 0 && distance(ped, pop) < 60) { this._startle(ped); hit = true; }
      for (const cop of this.police) if (distance(cop, pop) < 65) { cop.distracted = 1.8; hit = true; this._confetti(cop.x, cop.y, 20); }
      if (hit) this._raiseHeat(1, 'Confetti disturbance! Find a corner to hide.');
      return true;
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

    _startle(ped) {
      ped.stunned = 2.3; ped.bubble = this._pick(CURSES); ped.bubbleTimer = 3;
      this._confetti(ped.x, ped.y, 25); this._sound('pop');
    }

    recover() {
      const entity = this.current, p = this._safeRoadPosition(entity, this.player.vehicleId ? 18 : 10, this.player.vehicleId ? entity : null);
      entity.x = p.x; entity.y = p.y;
      if (this.player.vehicleId) { entity.speed = entity.vx = entity.vy = 0; entity.health = Math.max(25, entity.health); }
      this.player.x = p.x; this.player.y = p.y; this.player.composure = Math.max(60, this.player.composure);
      this.graceTimer = 2; this.score = Math.max(0, this.score - 20);
      this._toast('Unstuck! Back on the road. −20 style; your cash is safe.'); this._confetti(p.x, p.y, 22);
      return true;
    }

    _caught() {
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

    purchase(item) {
      if (!['repair', 'boost', 'armor'].includes(item)) return false;
      const garage = this.services.find(s => s.id === 'garage');
      if (distance(this.current, garage) >= 115) { this._toast('Visit the GARAGE on the map to buy a tune-up.'); return false; }
      if (item === 'repair') {
        if (!this.player.vehicleId) { this._toast('Hop in a car before buying a repair.'); return false; }
        if (this.current.health >= this.maxHealth) { this._toast('This ride is already in perfect condition.'); return false; }
        if (this.money < 45) { this._toast('A repair costs $45.', 'warning'); return false; }
        this.money -= 45; this.current.health = this.maxHealth;
      } else if (item === 'boost' || item === 'armor') {
        const level = this.upgrades[item], price = item === 'boost' ? 200 + level * 150 : 150 + level * 125;
        if (level >= 3) { this._toast('That upgrade is already maxed out.'); return false; }
        if (this.money < price) { this._toast('You need $' + price + ' for this upgrade.', 'warning'); return false; }
        this.money -= price; this.upgrades[item]++;
        if (item === 'armor') this.cars.forEach(car => { if (car.health > 0) car.health = Math.min(this.maxHealth, car.health + 25); });
      } else return false;
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
      if (this.player.vehicleId) this._drive(this.current, dt, input); else this._walk(dt, input);
      for (const car of this.cars) if (car.traffic && car.health > 0 && car.id !== this.player.vehicleId) this._traffic(car, dt);
      this._pedestrians(dt);
      this._updatePolice(dt);
      if (this.mission) {
        this.missionStats.elapsed += dt;
        this.mission.timeLeft = Math.max(0, this.mission.timeLeft - dt);
        if (this.mission.timeLeft === 0 && !this.missionStats.overtime) { this.missionStats.overtime = true; this._toast('Overtime! Finish the gig anyway; base pay is safe.'); }
        const target = this.mission.targets[this.mission.targetIndex];
        if (this.mission.type !== 'party' && (this.mission.type !== 'dash' || this.player.vehicleId) && distance(this.current, target) < 58) this._advanceMission();
      }
      for (const p of this.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-2 * dt); p.vy = p.vy * Math.exp(-2 * dt) + 18 * dt; }
      this.particles = this.particles.filter(p => p.life > 0);
      this.skidMarks.forEach(mark => { mark.life -= dt; }); this.skidMarks = this.skidMarks.filter(mark => mark.life > 0).slice(-250);
    }

    _walk(dt, input) {
      let x = Number(Boolean(input.right)) - Number(Boolean(input.left)), y = Number(Boolean(input.down)) - Number(Boolean(input.up));
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
      if (this._move(car, car.vx * dt, car.vy * dt, 18)) this._impact(car, impact, false);
      for (const other of this.cars) {
        if (other === car || other.health <= 0) continue;
        const d = distance(car, other);
        if (d < 36) {
          const nx = d > 0.01 ? (car.x - other.x) / d : Math.cos(car.angle + Math.PI / 2), ny = d > 0.01 ? (car.y - other.y) / d : Math.sin(car.angle + Math.PI / 2);
          this._move(car, nx * (36 - d), ny * (36 - d), 18);
          other.speed *= 0.5; this._impact(car, impact, true);
        } else if (d < 70 && impact > 170 && this.time - (this._nearMisses.get(other.id) ?? -20) > 14) {
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
      if (Math.hypot(car.vx, car.vy) > 55) for (const ped of this.peds) if (ped.stunned <= 0 && distance(ped, car) < 28) {
        this._startle(ped); this._raiseHeat(1, 'A resident is mildly inconvenienced. Confetti everywhere!'); car.speed *= 0.82;
      }
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
      if (distance(car, target) < 12) { car.x = target.x; car.y = target.y; car.route = this._wanderRoute(car); target = car.route[0]; }
      const angle = Math.atan2(target.y - car.y, target.x - car.x), desired = distance(car, target) < 75 ? 55 : 100;
      let speed = desired;
      if (this.cars.some(other => other !== car && other.health > 0 && distance(other, car) < 62 && Math.abs(wrapAngle(Math.atan2(other.y - car.y, other.x - car.x) - angle)) < 0.7)) speed = 8;
      car.speed += (speed - car.speed) * Math.min(1, dt * 4); car.angle = angle;
      for (const other of this.cars) if (other !== car && other.health > 0 && distance(other, car) < 70 && Math.abs(wrapAngle(Math.atan2(other.y - car.y, other.x - car.x) - angle)) < 0.7) car.speed = Math.min(car.speed, Math.max(0, distance(other, car) - 38) / dt);
      this._move(car, Math.cos(angle) * car.speed * dt, Math.sin(angle) * car.speed * dt, 18);
    }

    _pedestrians(dt) {
      for (const ped of this.peds) {
        ped.bubbleTimer = Math.max(0, ped.bubbleTimer - dt);
        if (!ped.bubbleTimer) ped.bubble = '';
        if (ped.stunned > 0) { ped.stunned = Math.max(0, ped.stunned - dt); continue; }
        const dx = Math.cos(ped.angle) * ped.pace * dt, dy = Math.sin(ped.angle) * ped.pace * dt;
        if (distance(ped, { x: ped.homeX, y: ped.homeY }) > 85) ped.angle = wrapAngle(ped.angle + Math.PI);
        if (this._move(ped, dx, dy, 5)) ped.angle = wrapAngle(ped.angle + Math.PI);
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
          if (this._move(cop, Math.cos(cop.angle) * cop.speed * dt, Math.sin(cop.angle) * cop.speed * dt, 17)) cop.routeTimer = 0;
        } else cop.speed *= Math.exp(-5 * dt);
        if (this.heat > 0 && this.graceTimer <= 0 && cop.distracted <= 0 && distance(cop, this.current) < (this.player.vehicleId ? 43 : 29)) contact = true;
      }
      this.policeSeen = seen;
      if (this.heat > 0) {
        this.escapeTimer = seen ? 0 : this.escapeTimer + dt;
        if (this.escapeTimer >= this.escapeGoal) { this.heat = 0; this.escapeTimer = 0; this._toast('Fun Police escaped! Back to the biscuits.', 'success'); this._sound('escape'); this._addScore(25); }
      } else this.escapeTimer = 0;
      this.player.composure = clamp(this.player.composure + (contact ? -27 : 7) * dt, 0, 100);
      if (this.player.composure <= 0) this._caught();
    }

    exportSave() { return { version: 1, money: this.money, score: this.score, bestScore: this.bestScore, completed: this.completed, upgrades: { ...this.upgrades } }; }

    loadSave(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data) || (data.version !== undefined && data.version !== 1)) return false;
      const upgrades = data.upgrades && typeof data.upgrades === 'object' ? data.upgrades : {};
      this.money = numeric(data.money, 150, 0, 999999);
      this.score = numeric(data.score, 0, 0, 999999);
      this.bestScore = Math.max(this.score, numeric(data.bestScore, 0, 0, 999999));
      this.completed = numeric(data.completed, 0, 0, 9999);
      this.upgrades.boost = numeric(upgrades.boost, 0, 0, 3);
      this.upgrades.armor = numeric(upgrades.armor, 0, 0, 3);
      this.cars.forEach(car => { car.health = clamp(car.health + this.upgrades.armor * 25, 0, this.maxHealth); });
      return true;
    }
  }

  const api = { Game, SIZE, ROAD_CENTERS, ROAD_WIDTH, CAR_TYPES };
  root.MayhemCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
