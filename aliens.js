/* Ambient visitors share pedestrian routes and yield to conventional aircraft. */
(function (root) {
  'use strict';
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const wrap = value => Math.atan2(Math.sin(value), Math.cos(value));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const TIMING = Object.freeze({ firstMin: 35, firstMax: 60, intervalMin: 110, intervalMax: 180, beam: 7, returnDelay: 22 });

  class AlienSystem {
    constructor(game, options = {}) {
      this.game = game;
      // Ambient events must not change traffic/mission random sequences.
      this._seed = ((game._seed || 42) ^ 0xa11e900d) >>> 0;
      this.time = 0;
      this.visits = 0;
      this.capture = null;
      this.nextVisit = mix(TIMING.firstMin, TIMING.firstMax, this._random());
      this.saucer = { id: 'saucer-a', kind: 'saucer', visible: false, phase: 'idle', phaseTime: 0,
        x: -800, y: 0, elevation: 130, angle: 0, speed: 0, beam: 0, yielding: false };
      if (options.populate !== false) this._disguiseVisitors(options.visitors ?? 4);
    }

    _random() { this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0; return this._seed / 4294967296; }
    _ground(point) { return this.game._ground?.(point) ?? this.game.world?.terrain?.surfaceHeight?.(point.x, point.y) ?? 0; }
    _phase(phase) { this.saucer.phase = phase; this.saucer.phaseTime = 0; }

    _disguiseVisitors(count) {
      const candidates = (this.game.peds || []).filter(ped => ped.pathId && !ped.soldier && !ped.militaryUnit && !ped.transportedBy &&
        !['orchard', 'marsh', 'ridge', 'military'].includes(ped.district));
      const districts = new Set();
      for (let i = 0; i < count && candidates.length; i++) {
        const varied = candidates.filter(ped => !districts.has(ped.district));
        const pool = varied.length ? varied : candidates;
        const ped = pool[Math.floor(this._random() * pool.length)];
        ped.alien = true; ped.disguised = true;
        districts.add(ped.district); candidates.splice(candidates.indexOf(ped), 1);
      }
    }

    _openSky(ped) {
      if (!ped || ped === this.game.player || ped.alien || ped.soldier || ped.militaryUnit || ped.transportedBy ||
        ped.stunned > 0 || this.game.ragdolls?.get(ped.id) || ped.grounded === false) return false;
      const width = this.game.world?.bounds?.maxX || this.game.world?.mapWidth || 12000, height = this.game.world?.bounds?.maxY || this.game.world?.mapHeight || 8000;
      if (ped.x < 250 || ped.x > Math.min(width - 250, 9300) || ped.y < 500 || ped.y > height - 250) return false;
      if (this.game._dry && !this.game._dry(ped)) return false;
      // Check the real rotated footprint, rather than its axis-aligned bounds.
      return !(this.game.buildings || []).some(box => {
        const angle = box.angle || 0, c = Math.cos(angle), s = Math.sin(angle);
        const dx = ped.x - box.x - box.w / 2, dy = ped.y - box.y - box.h / 2;
        return Math.abs(dx * c + dy * s) < box.w / 2 + 14 && Math.abs(-dx * s + dy * c) < box.h / 2 + 14;
      });
    }

    _trafficNear(point, elevation, radius = 1000) {
      return (this.game.aircraft || []).filter(craft => craft.visible !== false && !craft.exploded && !craft.grounded &&
        distance(craft, point) < radius && Math.abs((craft.elevation || 0) - elevation) < 32);
    }

    _clearance(from, to) {
      let top = 0;
      for (let i = 0; i <= 32; i++) top = Math.max(top, this._ground({ x: mix(from.x, to.x, i / 32), y: mix(from.y, to.y, i / 32) }));
      for (const box of this.game.buildings || []) top = Math.max(top, (box.elevation ?? this._ground({ x: box.x, y: box.y })) + (box.height || 8));
      const ceiling = this.game.world?.landscape?.airspace?.ceiling || 900;
      return Math.min(ceiling - 30, top + 115);
    }

    _hoverHeight(point) {
      let top = this._ground(point) + 18;
      for (const box of this.game.buildings || []) if (distance(point, { x: box.x + box.w / 2, y: box.y + box.h / 2 }) < Math.hypot(box.w, box.h) / 2 + 150)
        top = Math.max(top, (box.elevation ?? this._ground({ x: box.x, y: box.y })) + (box.height || 8) + 7);
      return top;
    }

    startVisit() {
      if (this.saucer.visible || this.capture) return false;
      if (!this.game.world?.landscape) { this.nextVisit = 15; return false; }
      const candidates = (this.game.peds || []).filter(ped => this._openSky(ped));
      if (!candidates.length) { this.nextVisit = 15; return false; }
      const target = candidates[Math.floor(this._random() * candidates.length)];
      const world = this.game.world || {}, width = world.bounds?.maxX || world.mapWidth || 12000, height = world.bounds?.maxY || world.mapHeight || 8000;
      // Stay over the civilian city: northern military and eastern airport
      // runway approaches remain clear of ambient UFO entry paths.
      const edge = Math.floor(this._random() * 3), offset = 600 + this._random() * (width - 1800);
      const westEntry = edge === 0 || (edge === 1 && world.bounds?.minY < 0);
      const entry = westEntry ? { x: -800, y: 600 + this._random() * (height - 1200) } : { x: offset, y: edge === 1 ? -800 : height + 800 };
      this.destination = { x: target.x, y: target.y };
      this.targetId = target.id;
      this.exit = { x: -1000, y: 500 + this._random() * (height - 1000) };
      this.cruiseHeight = this._clearance(entry, this.destination);
      Object.assign(this.saucer, entry, { visible: true, elevation: this.cruiseHeight, speed: 0, beam: 0, yielding: false,
        angle: Math.atan2(target.y - entry.y, target.x - entry.x) });
      this._phase('approach'); this.visits++;
      this.game._toast?.('Unscheduled visitor over ' + (this.game.districtAt?.(target)?.name || 'town') + '.');
      return true;
    }

    _moveTo(point, elevation, speed, dt) {
      const saucer = this.saucer, gap = distance(saucer, point);
      const pace = Math.min(speed, Math.sqrt(gap * 500));
      saucer.speed += (pace - saucer.speed) * Math.min(1, dt * 2);
      const step = Math.min(gap, Math.max(0, saucer.speed) * dt);
      if (gap > .01) {
        saucer.angle = wrap(saucer.angle + wrap(Math.atan2(point.y - saucer.y, point.x - saucer.x) - saucer.angle) * Math.min(1, dt * 2));
        saucer.x += (point.x - saucer.x) / gap * step; saucer.y += (point.y - saucer.y) / gap * step;
      }
      saucer.elevation += clamp(elevation - saucer.elevation, -14 * dt, 24 * dt);
      return distance(saucer, point) < 6 && Math.abs(saucer.elevation - elevation) < .25;
    }

    _takeResident() {
      const ped = this.game.peds.find(person => person.id === this.targetId);
      if (!this._openSky(ped) || distance(ped, this.saucer) > 40) return false;
      const index = this.game.peds.indexOf(ped);
      this.capture = { ped, index, origin: { x: ped.x, y: ped.y, elevation: this._ground(ped), angle: ped.angle },
        elevation: this._ground(ped), progress: 0, visible: true, returnIn: null };
      this.game.peds.splice(index, 1);
      // A resident cannot report a player while being carried off by a UFO.
      if (this.game._witnessReports) this.game._witnessReports = this.game._witnessReports.filter(report => report.reporter !== ped);
      ped.bubble = 'OH, COME ON!'; ped.bubbleTimer = 3;
      this.destination = { x: ped.x, y: ped.y };
      return true;
    }

    _depart() {
      this.saucer.beam = 0;
      if (this.capture) this.capture.visible = false;
      this.cruiseHeight = this._clearance(this.saucer, this.exit);
      this._phase('depart');
    }

    _returnResident() {
      const capture = this.capture;
      if (!capture) return;
      const ped = capture.ped, candidates = [capture.origin];
      const path = this.game.pedPaths?.find(item => item.id === ped.pathId);
      if (path) candidates.push(...path.points);
      const point = candidates.find(candidate => (!this.game._personFree || this.game._personFree(candidate.x, candidate.y, 9)) &&
        (!this.game._dry || this.game._dry(candidate)) && !(this.game.peds || []).concat(this.game.player || [])
          .some(person => distance(person, candidate) < 24 && Math.abs((person.elevation ?? this._ground(person)) - this._ground(candidate)) < 2) &&
        !(this.game.cars || []).concat(this.game.police || [], this.game.aircraft || [])
          .some(vehicle => vehicle.visible !== false && distance(vehicle, candidate) < 75 && Math.abs((vehicle.elevation || 0) - this._ground(candidate)) < 3));
      if (!point) { capture.returnIn = 2; return; }
      Object.assign(ped, { x: point.x, y: point.y, elevation: this._ground(point), verticalVelocity: 0, grounded: true, stunned: 0,
        ragdollGrace: 2, bubble: 'WORST TAXI EVER.', bubbleTimer: 4 });
      if (!this.game.peds.includes(ped)) this.game.peds.splice(Math.min(capture.index, this.game.peds.length), 0, ped);
      this.capture = null;
    }

    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      let remaining = Math.min(.25, dt);
      while (remaining > .000001) { const tick = Math.min(1 / 60, remaining); this._step(tick); remaining -= tick; }
    }

    _step(dt) {
      this.time += dt;
      const saucer = this.saucer;
      if (this.capture?.returnIn !== null && this.capture?.returnIn !== undefined) {
        this.capture.returnIn -= dt;
        if (this.capture.returnIn <= 0) this._returnResident();
      }
      if (!saucer.visible) {
        this.nextVisit -= dt;
        if (this.nextVisit <= 0 && !this.capture) this.startVisit();
        return;
      }
      saucer.phaseTime += dt;
      const traffic = this._trafficNear(saucer, saucer.elevation);
      saucer.yielding = traffic.length > 0;
      if (saucer.yielding) {
        // Flight positions use map units; vertical clearance uses metres.
        saucer.beam = 0;
        const ceiling = this.game.world?.landscape?.airspace?.ceiling || 900;
        saucer.elevation = Math.min(ceiling - 10, saucer.elevation + dt * 24);
        if (this.capture || saucer.phase === 'beam') this._depart();
        return;
      }
      if (saucer.phase === 'approach') {
        const target = this.game.peds.find(ped => ped.id === this.targetId);
        if (!this._openSky(target)) { this._depart(); return; }
        this.destination = { x: target.x, y: target.y };
        if (this._moveTo(this.destination, this.cruiseHeight, 840, dt)) this._phase('descend');
      } else if (saucer.phase === 'descend') {
        if (saucer.phaseTime > 35) { this._depart(); return; }
        const target = this.game.peds.find(ped => ped.id === this.targetId);
        if (!this._openSky(target)) { this._depart(); return; }
        this.destination = { x: target.x, y: target.y };
        const hover = this._hoverHeight(target);
        if (this._trafficNear(target, hover, 1500).length) return;
        if (this._moveTo(this.destination, hover, 120, dt) && this._takeResident()) this._phase('beam');
      } else if (saucer.phase === 'beam') {
        const capture = this.capture;
        if (!capture) { this._depart(); return; }
        saucer.speed = 0;
        saucer.beam = smooth(saucer.phaseTime / .6) * (1 - smooth((saucer.phaseTime - 6.2) / .8));
        capture.progress = smooth((saucer.phaseTime - 1.2) / 4.8);
        capture.elevation = mix(capture.origin.elevation, saucer.elevation - .8, capture.progress);
        capture.visible = capture.progress < .99;
        if (saucer.phaseTime >= TIMING.beam) this._depart();
      } else if (saucer.phase === 'depart') {
        if (this._moveTo(this.exit, this.cruiseHeight, 1100, dt)) {
          saucer.visible = false; saucer.speed = 0; this._phase('idle');
          this.nextVisit = mix(TIMING.intervalMin, TIMING.intervalMax, this._random());
          if (this.capture) this.capture.returnIn = TIMING.returnDelay;
        }
      }
    }
  }

  const api = { AlienSystem, TIMING };
  root.MayhemAliens = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
