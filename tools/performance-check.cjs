'use strict';

// Deterministic CPU benchmark. Run on an otherwise idle machine; timings are
// diagnostic, not pass/fail thresholds. Node --cpu-prof can sample this workload.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const assert = require('node:assert/strict');
const project = path.resolve(process.env.MAYHEM_BENCHMARK_ROOT || path.join(__dirname, '..'));
const { Game } = require(path.join(project, 'core.js'));
const C = require(path.join(project, 'vendor/cannon.cjs'));
const label = process.argv[2] || 'capture';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Use an alphanumeric benchmark label.');
const game = new Game({ seed: 42 });
const dt = 1 / 60, warmup = 120, steps = 600;
for (let i = 0; i < warmup; i++) game.update(dt);
game.interact();
const scopes = new Map(), pairs = {};
function measure(target, method, name) {
  const original = target[method];
  target[method] = function (...args) {
    const before = performance.now();
    try { return original.apply(this, args); }
    finally {
      const elapsed = performance.now() - before;
      const scope = scopes.get(name) || { calls: 0, totalMs: 0, maxMs: 0 };
      scope.calls++; scope.totalMs += elapsed; scope.maxMs = Math.max(scope.maxMs, elapsed); scopes.set(name, scope);
    }
  };
}
measure(game.vehiclePhysics, 'step', 'vehicles');
measure(game, '_pedestrians', 'pedestrians');
measure(game.ragdolls, 'step', 'ragdolls');
measure(game.aviation, 'step', 'aircraft');
const contacts = C.Narrowphase.prototype.getContacts;
C.Narrowphase.prototype.getContacts = function (a, b, ...rest) {
  for (let i = 0; i < a.length; i++) {
    const key = [a[i].kind || (a[i].type === C.Body.DYNAMIC ? 'car' : 'static'), b[i].kind || (b[i].type === C.Body.DYNAMIC ? 'car' : 'static')].sort().join('/');
    pairs[key] = (pairs[key] || 0) + 1;
  }
  return contacts.call(this, a, b, ...rest);
};
measure(C.Narrowphase.prototype, 'getContacts', 'narrowphase');
const frameMs = [], snapshots = [];
const start = performance.now();
for (let i = 0; i < steps; i++) {
  // A reproducible mix of driving, hard turns, a recovery and on-foot tumbling.
  if (i === 240) game.recover();
  if (i === 420) {
    // Put the ride on a safe road with its real body stopped before dismounting.
    game.recover();
    assert.equal(game.interact(), true, 'benchmark dismounts onto a safe road');
  }
  if (i === 510) assert.equal(game.flop(), true, 'benchmark exercises a real articulated tumble after recovery grace');
  const before = performance.now();
  game.update(dt, { up: i < 420, right: i >= 150 && i < 220, left: i >= 300 && i < 340, boost: i >= 60 && i < 130 });
  frameMs.push(performance.now() - before);
  if (i % 60 === 59) snapshots.push({ step: i + 1, player: { ...game.player }, cars: game.cars.map(car => ({ id: car.id, x: car.x, y: car.y, elevation: car.elevation, health: car.health })), heat: game.heat, ragdolls: game.ragdolls.bodies.size });
}
const elapsedMs = performance.now() - start;
frameMs.sort((a, b) => a - b);
const report = { label, steps, simulatedSeconds: steps * dt, elapsedMs, meanStepMs: frameMs.reduce((a, b) => a + b, 0) / steps,
  p95StepMs: frameMs[Math.floor(steps * .95)], scopes: Object.fromEntries(scopes), pairs, snapshots };
const directory = path.resolve(__dirname, '../playtest-evidence/performance');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, `simulation-${label}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, snapshots: undefined }, null, 2));
