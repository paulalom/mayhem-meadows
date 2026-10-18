/* Development-only scoped CPU timings; injected by serve.cjs for ?profile=1. */
(() => {
  'use strict';
  const LIMIT = 120000, EVENT_LIMIT = 200000;
  const cameraMode = new URLSearchParams(location.search).get('camera') === '1';
  // Optional repeatable town for before/after playthroughs, confined to this
  // development profiler. Normal game startup keeps its existing random seed.
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed !== null && /^\d+$/.test(seed)) {
    const Game = MayhemCore.Game;
    MayhemCore.Game = class extends Game { constructor(options = {}) { super({ seed: Number(seed), ...options }); } };
  }
  const now = () => performance.now();
  let recording = false, startedAt = 0, previousFrame = 0, scene;
  let events = [], frames = [], stages = new Map(), stack = [], dropped = 0, lastCapture;
  let cameraFrames = [], marks = [], longFrames = [], simulationSteps = 0;
  let pointerEvents = 0, pointerDX = 0, pointerDY = 0, scenePaused = true;
  const cameraColumns = ['timeMs', 'intervalMs', 'cpuMs', 'simulationSteps', 'simulationTimeSeconds',
    'pointerEvents', 'pointerDX', 'pointerDY', 'mouseLocked', 'yaw', 'pitch',
    'cameraX', 'cameraY', 'cameraZ', 'targetX', 'targetY', 'targetZ',
    'subjectX', 'subjectY', 'subjectZ', 'cameraDistance', 'obstructed', 'mode', 'paused', 'renderCalls', 'triangles'];
  const observedTypes = cameraMode && typeof PerformanceObserver !== 'undefined'
    ? ['long-animation-frame', 'longtask'].filter(type => PerformanceObserver.supportedEntryTypes?.includes(type)) : [];
  const observers = observedTypes.map(type => new PerformanceObserver(list => {
    if (!recording) return;
    for (const entry of list.getEntries()) {
      if (entry.startTime < startedAt) continue;
      const details = { type, timeMs: entry.startTime - startedAt, durationMs: entry.duration,
        blockingDurationMs: entry.blockingDuration, renderStart: entry.renderStart, styleAndLayoutStart: entry.styleAndLayoutStart,
        scripts: entry.scripts?.map(script => ({ function: script.sourceFunctionName, url: script.sourceURL,
          invoker: script.invokerType, durationMs: script.duration, forcedLayoutMs: script.forcedStyleAndLayoutDuration })) };
      longFrames.push(details); event(type, entry.startTime, entry.duration, details);
    }
  }));
  const panel = document.createElement('aside');
  panel.id = 'performance-profiler';
  panel.style.cssText = 'position:fixed;right:12px;top:12px;z-index:10000;background:#101c29;color:#f3f6dd;padding:12px;border:1px solid #d9ed7a;border-radius:6px;font:13px/1.4 monospace;max-width:460px;max-height:65vh;overflow:auto';
  const status = document.createElement('div');
  status.id = 'profile-status';
  status.textContent = cameraMode ? 'Camera trace armed — press Play. F9 marks a stutter.' : 'Trace armed — press Play to record up to 2 minutes.';
  const controls = document.createElement('div');
  const start = document.createElement('button'), stop = document.createElement('button'), download = document.createElement('button');
  start.textContent = 'Record trace'; stop.textContent = 'Stop and save trace'; download.textContent = 'Download trace';
  stop.disabled = true; download.disabled = true;
  for (const button of [start, stop, download]) {
    button.type = 'button'; button.style.cssText = 'margin:6px 4px 0 0;padding:5px;font:inherit'; controls.append(button);
  }
  const results = document.createElement('pre'); results.id = 'profile-results'; results.style.cssText = 'white-space:pre-wrap;margin:8px 0 0;font:11px/1.4 monospace';
  panel.append(status, controls, results); document.body.append(panel);

  function event(name, ts, duration, args) {
    if (events.length >= EVENT_LIMIT) { dropped++; return; }
    events.push({ name, cat: 'mayhem', ph: 'X', pid: 1, tid: 1, ts: (ts - startedAt) * 1000, dur: duration * 1000, ...(args ? { args } : {}) });
  }
  function timed(name, fn, receiver, args) {
    const begin = now(), call = { children: 0 };
    stack.push(call);
    try { return fn.apply(receiver, args); }
    finally {
      const elapsed = now() - begin;
      stack.pop();
      if (stack.length) stack[stack.length - 1].children += elapsed;
      let stage = stages.get(name);
      if (!stage) { stage = { name, calls: 0, totalMs: 0, selfMs: 0, maxMs: 0 }; stages.set(name, stage); }
      stage.calls++; stage.totalMs += elapsed; stage.selfMs += Math.max(0, elapsed - call.children); stage.maxMs = Math.max(stage.maxMs, elapsed);
      // Keep tiny calls in aggregates without flooding the trace or allocating per call.
      if (elapsed >= 0.15 || name === 'frame') event(name, begin, elapsed);
    }
  }
  function wrap(target, names, prefix) {
    for (const name of names) {
      const original = target?.[name];
      if (typeof original !== 'function') continue;
      target[name] = function (...args) {
        if (recording && prefix === 'simulation' && name === 'update') simulationSteps++;
        return recording ? timed(prefix + '.' + name, original, this, args) : original.apply(this, args);
      };
    }
  }
  // Camera captures avoid the thousands of tiny per-person/vehicle wrappers
  // used in the detailed CPU capture, keeping input/frame telemetry lightweight.
  wrap(MayhemCore.Game.prototype, cameraMode ? ['update'] : ['update', '_pedestrians', '_walk', '_traffic', '_updatePolice', '_vehiclePeople', '_staticParts', '_resolvePerson', '_move', '_vehicleDamageStep', '_projectiles', '_waterRecovery'], 'simulation');
  wrap(MayhemVehiclePhysics.VehicleWorld.prototype, cameraMode ? ['step'] : ['sync', 'step', '_drive', '_syncAircraft', '_nearGround', '_supported'], 'vehicles');
  wrap(MayhemPhysics.RagdollWorld.prototype, ['step'], 'ragdolls');
  wrap(MayhemAircraft.AircraftSystem.prototype, ['step'], 'aircraft');
  wrap(MayhemAliens.AlienSystem.prototype, ['step'], 'aliens');
  wrap(MayhemAudio.AudioDirector.prototype, ['update'], 'audio');
  if (!cameraMode) wrap(MayhemWorld.RoadNetwork.prototype, ['project', 'nearestRoad', 'route'], 'roads');
  wrap(CANNON.World.prototype, ['step'], 'cannon');
  wrap(CANNON.SAPBroadphase.prototype, ['collisionPairs'], 'broadphase');
  wrap(CANNON.Narrowphase.prototype, ['getContacts'], 'narrowphase');
  wrap(CANNON.GSSolver.prototype, ['solve'], 'solver');
  wrap(MayhemScene.prototype, ['_syncDestructibleProps', '_people', '_cars', '_aircraftStep', '_effects', '_landscapeStep', '_cameraStep'], 'scene');
  if (cameraMode) wrap(MayhemScene.prototype, ['_boomFraction', '_terrainBoomFraction', '_insideBuilding', 'orbit'], 'camera');
  const update = MayhemScene.prototype.update;
  MayhemScene.prototype.update = function (...args) {
    scenePaused = Boolean(args[1]?.paused);
    if (scene !== this) {
      scene = this;
      wrap(this.renderer, ['render'], 'webgl');
      wrap(this.scene, ['updateMatrixWorld'], 'transforms');
    }
    return recording ? timed('scene.update', update, this, args) : update.apply(this, args);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => raf(timestamp => {
    if (!recording) return callback(timestamp);
    const interval = previousFrame ? timestamp - previousFrame : 0;
    if (previousFrame) frames.push(interval);
    previousFrame = timestamp;
    simulationSteps = 0;
    const cpuStart = now();
    const result = timed('frame', callback, window, [timestamp]);
    if (cameraMode && scene) {
      const info = scene.cameraInfo, subject = scene.game.current, render = scene.renderer.info.render;
      cameraFrames.push([timestamp - startedAt, interval, now() - cpuStart, simulationSteps, scene.game.time,
        pointerEvents, pointerDX, pointerDY, document.pointerLockElement === scene.canvas,
        info.viewYaw, info.viewPitch, info.x, info.y, info.z, info.targetX, info.targetY, info.targetZ,
        subject.x / 20, subject.elevation || 0, subject.y / 20, info.distance, info.obstructed, info.mode,
        scenePaused || document.hidden, render.calls, render.triangles]);
      pointerEvents = pointerDX = pointerDY = 0;
    }
    if (now() - startedAt >= LIMIT) finish();
    return result;
  });
  function begin() {
    if (recording) return;
    events = []; frames = []; stages = new Map(); stack = []; dropped = 0;
    cameraFrames = []; marks = []; longFrames = []; simulationSteps = 0;
    pointerEvents = pointerDX = pointerDY = 0;
    startedAt = now(); previousFrame = 0; recording = true;
    observers.forEach((observer, index) => observer.observe({ type: observedTypes[index] }));
    start.disabled = true; stop.disabled = false; download.disabled = true; results.textContent = '';
    status.textContent = cameraMode ? 'RECORDING CAMERA — move/look normally. F9 marks a stutter. Auto-saves in 2 minutes.' : 'RECORDING — play normally. Saves automatically after 2 minutes.';
  }
  function percentile(values, fraction) {
    return values.length ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] : 0;
  }
  async function finish() {
    if (!recording) return;
    recording = false; start.disabled = false; stop.disabled = true;
    observers.forEach(observer => observer.disconnect());
    const durationMs = now() - startedAt, ordered = frames.slice().sort((a, b) => a - b);
    const summary = {
      durationMs, frameIntervals: frames.length, averageFrameMs: frames.reduce((a, b) => a + b, 0) / (frames.length || 1),
      captureMode: cameraMode ? 'camera' : 'cpu', cameraSamples: cameraFrames.length, stutterMarks: marks.length, observedTypes,
      medianFrameMs: percentile(ordered, 0.5), p95FrameMs: percentile(ordered, 0.95), p99FrameMs: percentile(ordered, 0.99),
      framesOver33ms: frames.filter(value => value > 33.34).length, droppedEvents: dropped,
      stages: [...stages.values()].sort((a, b) => b.selfMs - a.selfMs),
      render: scene ? { calls: scene.renderer.info.render.calls, triangles: scene.renderer.info.render.triangles, geometries: scene.renderer.info.memory.geometries, textures: scene.renderer.info.memory.textures } : null,
      world: scene ? { peds: scene.game.peds.length, cars: scene.game.cars.length, police: scene.game.police.length, buildings: scene.game.buildings.length, props: scene.game.staticObjects.length, physicsBodies: scene.game.vehiclePhysics.world.bodies.length } : null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      note: 'Instrumented main-thread scopes; inclusive totals overlap. Frame intervals include pauses/background time. WebGL duration is CPU submission, not GPU time.'
    };
    lastCapture = { displayTimeUnit: 'ms', metadata: { capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, url: location.href }, summary, traceEvents: events,
      ...(cameraMode ? { camera: { columns: cameraColumns, frames: cameraFrames, marks, longFrames } } : {}) };
    results.textContent = JSON.stringify(summary, null, 2);
    download.disabled = false; status.textContent = 'Saving trace locally…';
    try {
      const response = await fetch('/__profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lastCapture) });
      if (!response.ok) throw new Error('Save failed');
      const saved = await response.json(); status.textContent = 'Trace saved: playtest-evidence/performance/' + saved.file;
    } catch (_) { status.textContent = 'Local save failed — use Download trace to keep the capture.'; }
  }
  start.addEventListener('click', begin); stop.addEventListener('click', finish);
  document.getElementById('play-button').addEventListener('click', begin, { once: true });
  if (cameraMode) {
    document.addEventListener('pointermove', input => {
      if (!recording || input.target?.id !== 'game-canvas') return;
      pointerEvents++; pointerDX += input.movementX; pointerDY += input.movementY;
    }, { capture: true, passive: true });
    window.addEventListener('keydown', input => {
      if (!recording || input.code !== 'F9' || input.repeat) return;
      input.preventDefault();
      const time = now(); marks.push(time - startedAt);
      event('User marked stutter', time, 0, { mark: marks.length });
    });
  }
  download.addEventListener('click', () => {
    if (!lastCapture) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(lastCapture)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mayhem-performance-trace.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  // A wall-clock deadline also saves if the game is paused or the tab is hidden.
  setInterval(() => {
    if (!recording) return;
    const seconds = Math.floor((now() - startedAt) / 1000);
    status.textContent = cameraMode ? `RECORDING CAMERA ${seconds}/120s — F9 marks stutter (${marks.length}). Esc then Stop saves.` : `RECORDING ${seconds}/120s — Esc releases mouse; Stop saves early.`;
    if (now() - startedAt >= LIMIT) finish();
  }, 1000);
})();
