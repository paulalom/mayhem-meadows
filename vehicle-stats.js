(function (root) {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const CAR_TYPES = Object.freeze({
    compact: Object.freeze({ name: 'Pocket Rocket', maxSpeed: 300, acceleration: 430, handling: 2.7, grip: 9, mass: 1, width: 27, length: 46 }),
    sports: Object.freeze({ name: 'Sprinkle GT', maxSpeed: 370, acceleration: 490, handling: 2.5, grip: 6, mass: 0.9, width: 28, length: 49 }),
    van: Object.freeze({ name: 'Party Wagon', maxSpeed: 260, acceleration: 340, handling: 2.1, grip: 10, mass: 1.4, width: 32, length: 55 }),
    tank: Object.freeze({ name: 'Northwatch Warden', maxSpeed: 125, acceleration: 110, handling: 0.8, grip: 12, mass: 7.5, width: 48, length: 104, height: 2.6, maxHealth: 600 }),
    truck: Object.freeze({ name: 'Northwatch Carrier', maxSpeed: 215, acceleration: 180, handling: 1.25, grip: 11, mass: 3.5, width: 48, length: 116, height: 2.8, maxHealth: 240 })
  });
  const model = (id, kind, make, name, stats) => Object.freeze({ ...CAR_TYPES[kind], id, kind, make, model: name, name, ...stats });
  const CAR_MODELS = Object.freeze({
    'bramble-pocket-rocket': model('bramble-pocket-rocket', 'compact', 'Bramble', 'Pocket Rocket', { durability: 1, engineDurability: 1 }),
    'pogo-streetbug': model('pogo-streetbug', 'compact', 'Pogo', 'Streetbug', { maxSpeed: 275, acceleration: 465, handling: 3, grip: 10, durability: 0.9, engineDurability: 1.08 }),
    'glitterline-sprinkle-gt': model('glitterline-sprinkle-gt', 'sports', 'Glitterline', 'Sprinkle GT', { durability: 0.88, engineDurability: 0.9 }),
    'fable-comet-rs': model('fable-comet-rs', 'sports', 'Fable', 'Comet RS', { maxSpeed: 400, acceleration: 525, handling: 2.3, grip: 5.4, durability: 0.8, engineDurability: 0.82 }),
    'mirth-party-wagon': model('mirth-party-wagon', 'van', 'Mirth Motors', 'Party Wagon', { durability: 1.2, engineDurability: 1.15 }),
    'tumble-hauler': model('tumble-hauler', 'van', 'Tumble', 'Hauler', { maxSpeed: 240, acceleration: 315, handling: 1.9, grip: 11, mass: 1.55, durability: 1.4, engineDurability: 1.3 }),
    'northwatch-warden': model('northwatch-warden', 'tank', 'Northwatch', 'Warden', { durability: 4, engineDurability: 4 }),
    'northwatch-carrier': model('northwatch-carrier', 'truck', 'Northwatch', 'Carrier', { durability: 1.8, engineDurability: 1.6 })
  });
  const DEFAULT_MODELS = Object.freeze({ compact: 'bramble-pocket-rocket', sports: 'glitterline-sprinkle-gt', van: 'mirth-party-wagon', tank: 'northwatch-warden', truck: 'northwatch-carrier' });
  // Metres, relative to the vehicle's ground anchor. The Blender mesh and
  // every contact system share these articulated solid volumes.
  const TANK_GEOMETRY = Object.freeze({
    hullHalf: Object.freeze([2.6, 0.7, 1.2]), hullCenter: Object.freeze([0, 0.7, 0]),
    turretHalf: Object.freeze([1.1, 0.475, 0.8]), turretCenter: Object.freeze([0, 1.925, 0]),
    turretPivot: Object.freeze([0, 1.55, 0]), gunPivot: Object.freeze([0.9, 2.05, 0]),
    barrelHalf: Object.freeze([1.55, 0.1, 0.1]), barrelLength: 3.1, height: 2.6, centerHeight: 0.7
  });

  function getModel(vehicle = {}) {
    const kind = Object.hasOwn(CAR_TYPES, vehicle.kind) ? vehicle.kind : 'compact';
    const selected = Object.hasOwn(CAR_MODELS, vehicle.modelId) ? CAR_MODELS[vehicle.modelId] : null;
    return selected && selected.kind === kind ? selected : CAR_MODELS[DEFAULT_MODELS[kind]];
  }

  function condition(vehicle = {}) {
    const max = Math.max(1, finite(vehicle.maxHealth, 100));
    return clamp(finite(vehicle.health, max) / max, 0, 1);
  }

  function performance(vehicle = {}) {
    const base = getModel(vehicle), hull = condition(vehicle);
    const engineHealth = clamp(finite(vehicle.engineHealth, 100), 0, 100);
    const handlingHealth = clamp(finite(vehicle.handlingHealth, 100), 0, 100);
    const engine = engineHealth / 100, steering = handlingHealth / 100;
    const driveable = hull > 0 && engine > 0 && !vehicle.exploded;
    return {
      ...base, engineHealth, handlingHealth, driveable,
      acceleration: driveable ? base.acceleration * engine * (0.6 + 0.4 * hull) : 0,
      maxSpeed: driveable ? base.maxSpeed * (0.35 + 0.65 * engine) * (0.65 + 0.35 * hull) : 0,
      handling: base.handling * (0.45 + 0.55 * steering) * (0.7 + 0.3 * hull),
      grip: base.grip * (0.55 + 0.45 * steering) * (0.75 + 0.25 * hull)
    };
  }

  function status(vehicle = {}) {
    const hull = condition(vehicle), effective = performance(vehicle);
    if (vehicle.exploded || hull <= 0) return 'Wrecked';
    if (vehicle.burning) return 'On fire';
    const weakest = Math.min(hull, effective.engineHealth / 100, effective.handlingHealth / 100);
    return weakest <= 0.25 ? 'Critical' : weakest <= 0.55 ? 'Damaged' : weakest < 0.9 ? 'Dented' : 'Pristine';
  }

  function isDamaged(vehicle = {}) {
    const effective = performance(vehicle);
    return condition(vehicle) < 1 || effective.engineHealth < 100 || effective.handlingHealth < 100 || Boolean(vehicle.burning || vehicle.exploded);
  }

  function repair(vehicle, maxHealth = 100, amount = Infinity) {
    const oldHull = condition(vehicle), effective = performance(vehicle);
    const max = Math.max(1, finite(maxHealth, 100));
    const restored = amount === Infinity ? Infinity : Math.max(0, finite(amount, 0));
    vehicle.maxHealth = max;
    vehicle.health = clamp(oldHull * max + restored, 0, max);
    vehicle.engineHealth = clamp(effective.engineHealth + restored, 0, 100);
    vehicle.handlingHealth = clamp(effective.handlingHealth + restored, 0, 100);
    if (restored === Infinity || vehicle.health >= max && vehicle.engineHealth >= 100 && vehicle.handlingHealth >= 100) {
      vehicle.burning = false; vehicle.fireTime = 0; vehicle.exploded = false;
      delete vehicle.explosionTime;
    } else if (restored > 0 && vehicle.engineHealth > 25 && vehicle.health > 0) {
      vehicle.burning = false; vehicle.fireTime = 0;
    }
    return vehicle;
  }

  const api = { CAR_TYPES, CAR_MODELS, DEFAULT_MODELS, TANK_GEOMETRY, getModel, performance, condition, status, isDamaged, repair };
  root.MayhemVehicleStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
