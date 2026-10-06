'use strict';

// Optional UI checks: run with `node tools/browser-check.cjs` and Playwright installed.
// Chrome is headless here. Contexts and saves are isolated; pointer lock is
// virtualized, so checks never capture the user's desktop cursor. Relative look
// uses DOM PointerEvents; keyboard/buttons, WebGL and gameplay remain real.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { installBrowserInputFixture } = require('./browser-input-fixture.cjs');

function loadPlaywright() {
  const locations = [
    process.env.PLAYWRIGHT_MODULE_PATH,
    'playwright',
    'C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
  ].filter(Boolean);
  for (const location of locations) {
    try { return require(location); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Playwright is required for this optional check. Set PLAYWRIGHT_MODULE_PATH if needed.');
}

const project = path.resolve(__dirname, '..');
const evidence = path.join(project, 'playtest-evidence');
const url = pathToFileURL(path.join(project, 'index.html')).href;
const saveKey = 'mayhem-meadows.v1';
const errors = [];
const checks = [];
const diagnostics = {};
const checkFilter = process.env.BROWSER_CHECK_FILTER ? new RegExp(process.env.BROWSER_CHECK_FILTER, 'i') : null;

async function createTestContext(browser, options) {
  const context = await browser.newContext(options);
  try { await context.addInitScript(installBrowserInputFixture); }
  catch (error) { await context.close(); throw error; }
  return context;
}

async function releaseTestPointer(context) {
  await Promise.allSettled(context.pages().map(page => page.evaluate(() => globalThis.__browserInputFixture?.release())));
}

async function closeTestContext(context) {
  try { await releaseTestPointer(context); } finally { await context.close(); }
}

async function sceneState(page) {
  return page.locator('#game-canvas').evaluate(canvas => {
    const numeric = ['cameraYaw', 'cameraPitch', 'cameraFov', 'cameraDistance', 'worldX', 'worldY', 'frames', 'renderCalls', 'cameraX', 'cameraY', 'cameraZ', 'cameraTargetX', 'cameraTargetY', 'cameraTargetZ', 'ragdollCount', 'playerRagdollAge', 'renderedRagdolls'];
    const state = { ...canvas.dataset };
    for (const key of numeric) state[key] = Number(state[key]);
    state.targetX = state.cameraTargetX; state.targetY = state.cameraTargetY; state.targetZ = state.cameraTargetZ;
    return state;
  });
}

async function waitForScene(page, mode) {
  await page.waitForFunction(expectedMode => {
    const data = document.getElementById('game-canvas').dataset;
    return data.view === 'third-person-3d' && data.cameraMode === expectedMode && Number(data.renderCalls) > 0;
  }, mode, { timeout: 10000 });
  return sceneState(page);
}

async function assertRideName(page) {
  const expected = await page.evaluate(() => { const model = globalThis.MayhemVehicleStats.getModel(globalThis.__browserCheckGame.current);
    return model.make + ' ' + model.model; });
  await page.waitForFunction(name => document.getElementById('ride-name').textContent === name, expected, { timeout: 3000 });
  assert.equal(await page.locator('#ride-name').textContent(), expected);
}

async function captureMouse(page) {
  assert.equal(await page.evaluate(() => globalThis.__browserInputFixture?.assertSafe()), true, 'Capture requires the safe automated pointer fixture.');
  if (await page.evaluate(() => document.pointerLockElement === document.getElementById('game-canvas'))) return;
  await page.locator('#game-canvas').scrollIntoViewIfNeeded();
  const box = await page.locator('#game-canvas').boundingBox();
  assert.ok(box, 'Game canvas has no visible bounds.');
  const x = box.x + box.width * 0.53, y = box.y + box.height * 0.56;
  await page.mouse.click(x, y);
  await page.waitForFunction(() => document.pointerLockElement === document.getElementById('game-canvas') && document.getElementById('game-canvas').dataset.mouseLocked === 'true', null, { timeout: 3000 });
  await waitForFreshFrames(page);
}

async function lookCamera(page, dx, dy = 0) {
  await captureMouse(page);
  // Native pointer lock is intentionally absent. Relative DOM input reaches the
  // game's real handler without moving a pointer outside the visible viewport.
  await page.evaluate(async delta => {
    const canvas = document.getElementById('game-canvas');
    for (let step = 0; step < 8; step++) {
      globalThis.__browserInputFixture.relativeMove(canvas, delta.x / 8, delta.y / 8);
      await new Promise(requestAnimationFrame);
    }
  }, { x: dx, y: dy });
  await page.waitForTimeout(400);
}

async function fireToy(page) {
  await captureMouse(page);
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
}

async function aimAtResident(page, id) {
  await captureMouse(page);
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'true');
  await page.waitForTimeout(350);
  // Derive the angle from the live rendered view, then send virtual relative
  // input through the game's handler to aim at the resident's actual torso.
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = await page.evaluate(pedId => {
      const ped = globalThis.__browserCheckGame.peds.find(resident => resident.id === pedId);
      const camera = globalThis.__browserCheckScene.camera;
      const dx = ped.x / 20 - camera.position.x, dz = ped.y / 20 - camera.position.z;
      const torso = (ped.elevation || 0) + 1.05 * globalThis.MayhemPhysics.CHARACTER_SCALE;
      return { yaw: Math.atan2(dz, dx), pitch: Math.atan2(torso - camera.position.y, Math.hypot(dx, dz)) };
    }, id);
    const before = await sceneState(page);
    await lookCamera(page, angleDifference(target.yaw, before.cameraYaw) / (0.004 * 0.55), -(target.pitch - before.cameraPitch) / (0.0035 * 0.55));
  }
}

async function unlockToUI(page) {
  if (!await page.evaluate(() => Boolean(document.pointerLockElement))) return;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.pointerLockElement, null, { timeout: 3000 });
  await page.locator('#pause-screen').waitFor({ state: 'visible' });
  await page.locator('#resume-button').click();
  await page.locator('#pause-screen').waitFor({ state: 'hidden' });
}

function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

async function waitForMinimap(page) {
  await page.waitForFunction(() => {
    const canvas = document.getElementById('minimap-canvas');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0) opaque++;
      colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    }
    return opaque > canvas.width * canvas.height * 0.95 && colors.size > 5;
  }, null, { timeout: 3000 });
}

async function waitForFreshFrames(page) {
  const before = (await sceneState(page)).frames;
  await page.waitForFunction(previous => Number(document.getElementById('game-canvas').dataset.frames) > previous + 2, before, { timeout: 10000 });
  return sceneState(page);
}

async function driveNetworkRoute(page, destination, trace) {
  const route = await page.evaluate(target => globalThis.__browserCheckGame.network.route(globalThis.__browserCheckGame.current, target, 0), destination);
  assert.ok(route.length > 4, 'The journey must use sampled roads through the actual graph.');
  const held = new Set(), started = Date.now();
  let cursor = 0, previousAngle;
  trace.waypoints = route.length; trace.samples = []; trace.steeringChanges = 0; trace.headingChange = 0; trace.maxRoadDistance = 0;
  async function hold(key, enabled) {
    if (enabled === held.has(key)) return;
    if (enabled) { await page.keyboard.down(key); held.add(key); }
    else { await page.keyboard.up(key); held.delete(key); }
  }
  try {
    while (Date.now() - started < 60000) {
      const car = await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, car = game.current, road = game.network.project(car);
        return { x: car.x, y: car.y, angle: car.angle, speed: car.speed, upright: car.upright, health: car.health,
          elevation: car.elevation, groundHeight: globalThis.__browserCheckGround(car),
          water: Boolean(game.world.terrain?.isWater(car.x, car.y)),
          roadDistance: road.distance, roadWidth: road.width, district: game.districtAt(car).id };
      });
      assert.ok([car.x, car.y, car.angle, car.speed, car.elevation, car.groundHeight].every(Number.isFinite), 'The real vehicle pose must stay finite during the journey.');
      const remaining = Math.hypot(car.x - destination.x, car.y - destination.y);
      trace.maxRoadDistance = Math.max(trace.maxRoadDistance, car.roadDistance);
      if (previousAngle !== undefined) trace.headingChange += Math.abs(angleDifference(car.angle, previousAngle));
      previousAngle = car.angle;
      if (trace.samples.length < 650) trace.samples.push({ ...car, remaining });
      if (remaining < 42) { trace.arrived = car; return car; }
      let nearest = cursor, nearestDistance = Infinity;
      for (let i = cursor; i < Math.min(route.length, cursor + 35); i++) {
        const d = Math.hypot(car.x - route[i].x, car.y - route[i].y);
        if (d < nearestDistance) { nearest = i; nearestDistance = d; }
      }
      cursor = nearest;
      let aimIndex = cursor;
      while (aimIndex < route.length - 1 && Math.hypot(route[aimIndex].x - car.x, route[aimIndex].y - car.y) < 65) aimIndex++;
      const aim = route[aimIndex], delta = angleDifference(Math.atan2(aim.y - car.y, aim.x - car.x), car.angle);
      const limit = Math.abs(delta) > 0.75 ? 80 : Math.abs(delta) > 0.35 ? 130 : 195;
      const steerLeft = delta < -0.07, steerRight = delta > 0.07;
      if (steerLeft !== held.has('a') || steerRight !== held.has('d')) trace.steeringChanges++;
      await hold('a', steerLeft); await hold('d', steerRight);
      await hold('s', car.speed > limit + 25); await hold('w', car.speed < limit && car.speed >= -10);
      await page.waitForTimeout(80);
    }
    throw new Error(`Real-keyboard journey did not reach the graph destination; last position ${JSON.stringify(trace.samples.at(-1))}`);
  } finally {
    for (const key of held) await page.keyboard.up(key);
  }
}

async function captureNetworkOverview(page) {
  await page.keyboard.press('p');
  await page.locator('#pause-screen').waitFor({ state: 'visible' });
  await page.locator('#resume-button').click();
  await captureMouse(page);
  await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('toast')).opacity) === 0, null, { timeout: 6000 });
  // This temporary evidence camera uses the real renderer and world meshes.
  // It is never installed as a gameplay camera or persisted in a player save.
  await page.evaluate(() => {
    const scene = globalThis.__browserCheckScene, T = scene.T, world = globalThis.__browserCheckGame.world;
    const width = (world.mapWidth || world.size) / 20, height = (world.mapHeight || world.size) / 20;
    const canvas = document.getElementById('game-canvas'), halfWidth = width * 0.56, halfHeight = halfWidth * canvas.height / canvas.width;
    const camera = new T.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 2000);
    camera.position.set(width / 2, 450, height / 2); camera.up.set(0, 0, -1); camera.lookAt(width / 2, 0, height / 2); camera.updateMatrixWorld(true);
    const overlays = [...document.getElementById('game-shell').children].filter(element => element.tagName !== 'CANVAS');
    globalThis.__browserOverviewEvidence = { original: scene.renderer.render, fog: scene.scene.fog,
      overlays: overlays.map(element => ({ element, visibility: element.style.visibility })) };
    for (const element of overlays) element.style.visibility = 'hidden';
    scene.scene.fog = null;
    scene.renderer.render = function (world) { return globalThis.__browserOverviewEvidence.original.call(this, world, camera); };
    scene.renderer.render(scene.scene, scene.camera);
  });
  try {
    await page.locator('#game-canvas').screenshot({ path: path.join(evidence, 'desktop-terrain-city-overview.png') });
  } finally {
    await page.evaluate(() => {
      const scene = globalThis.__browserCheckScene, saved = globalThis.__browserOverviewEvidence;
      scene.renderer.render = saved.original; scene.scene.fog = saved.fog;
      for (const { element, visibility } of saved.overlays) element.style.visibility = visibility;
      delete globalThis.__browserOverviewEvidence;
    });
  }
}

// Only this isolated test context captures the engine. Normal game pages never
// expose a debug instance. Wrapping constructors leaves the real simulation,
// renderer, controls and fixed-step loop in charge of every tested outcome.
async function installEngineInspection(context) {
  await context.addInitScript(() => {
    let core, Scene, audio;
    Object.defineProperty(globalThis, 'MayhemCore', {
      configurable: true,
      get() { return core; },
      set(value) {
        core = { ...value, Game: class extends value.Game {
          constructor(...args) { super(...args); globalThis.__browserCheckGame = this; }
        } };
      },
    });
    Object.defineProperty(globalThis, 'MayhemScene', {
      configurable: true,
      get() { return Scene; },
      set(value) {
        Scene = class extends value {
          constructor(...args) { super(...args); globalThis.__browserCheckScene = this; }
        };
      },
    });
    Object.defineProperty(globalThis, 'MayhemAudio', {
      configurable: true,
      get() { return audio; },
      set(value) {
        audio = { ...value, AudioDirector: class extends value.AudioDirector {
          constructor(...args) { super(...args); globalThis.__browserCheckAudioDirector = this; }
        } };
      },
    });
    // Isolated scenario poses are derived from the live road graph. The real
    // game update, native keyboard events and Cannon contacts still produce
    // every movement and collision outcome checked below.
    globalThis.__browserCheckGround = point => globalThis.__browserCheckGame.world.terrain?.surfaceHeight(point.x, point.y) || 0;
    globalThis.__browserCheckPose = point => { const { road, ...pose } = point; return { ...pose, elevation: globalThis.__browserCheckGround(point) }; };
    globalThis.__browserCheckLane = () => {
      const game = globalThis.__browserCheckGame;
      for (const road of game.roads) for (const fraction of [0.25, 0.5, 0.75]) {
        const center = game.network.pointOnRoad(road.id, road.length * fraction);
        const ux = Math.cos(center.angle), uy = Math.sin(center.angle), nx = -uy, ny = ux;
        const point = (along = 0, across = 0) => globalThis.__browserCheckPose({ x: center.x + ux * along + nx * across, y: center.y + uy * along + ny * across });
        // Generic straight-impact fixtures use a genuinely nearly level street;
        // separate terrain checks below exercise sloping surfaces explicitly.
        const heights = [-180, -90, 0, 90, 180].map(along => point(along).elevation);
        if (Math.max(...heights) - Math.min(...heights) > 0.2 || road.bridge) continue;
        const free = [-180, -90, 0, 90, 180].every(along => [-25, 0, 25].every(across => {
          const p = point(along, across), projected = game.network.project(p);
          return projected.distance < projected.width / 2 - 12 && game._vehicleFree({ ...game.cars[0], ...p,
            angle: center.angle, orientation: null, upright: true });
        }));
        if (free) return { ...center, ux, uy, nx, ny, point,
          along: entity => (entity.x - center.x) * ux + (entity.y - center.y) * uy,
          across: entity => (entity.x - center.x) * nx + (entity.y - center.y) * ny };
      }
      throw new Error('The actual road network needs a clear stretch for controlled driving and toy checks.');
    };
    globalThis.__browserCheckWall = () => {
      const game = globalThis.__browserCheckGame;
      for (const building of game.buildings.filter(b => Math.abs(Math.sin(2 * (b.angle || 0))) > 0.2)) {
        const angle = building.angle || 0, ux = Math.cos(angle), uy = Math.sin(angle);
        const center = { x: building.x + building.w / 2, y: building.y + building.h / 2 };
        const point = gap => globalThis.__browserCheckPose({ x: center.x - ux * (building.w / 2 + gap), y: center.y - uy * (building.w / 2 + gap) });
        const heights = [28, 42, 56, 70].map(gap => point(gap).elevation);
        if (Math.max(...heights) - Math.min(...heights) > 0.2) continue;
        if ([28, 42, 56, 70].every(gap => game._vehicleFree({ ...game.cars[0], ...point(gap), angle, orientation: null, upright: true })))
          return { building, angle, ux, uy, center, point };
      }
      throw new Error('The generated town needs a clear rotated building frontage.');
    };
    globalThis.__browserCheckService = () => {
      const game = globalThis.__browserCheckGame, garage = game.services.find(service => service.id === 'garage');
      const road = game.network.project(garage);
      const direction = road.road.length - road.s >= 60 ? 1 : -1;
      return { garage: globalThis.__browserCheckPose(garage), car: globalThis.__browserCheckPose(game.network.pointOnRoad(road.roadId, road.s + direction * 50)),
        player: globalThis.__browserCheckPose(game.network.pointOnRoad(road.roadId, road.s + direction * 18)), road, direction };
    };
    globalThis.__browserCheckHill = () => {
      const game = globalThis.__browserCheckGame, candidates = [];
      for (const road of game.roads.filter(road => !road.bridge && road.length > 450)) {
        const span = Math.min(600, road.length - 80);
        for (const fraction of [0, 0.25, 0.5, 0.75]) {
          const from = Math.min(road.length - span - 20, 20 + road.length * fraction), to = from + span;
          const a = globalThis.__browserCheckPose(game.network.pointOnRoad(road.id, from));
          const b = globalThis.__browserCheckPose(game.network.pointOnRoad(road.id, to));
          const rise = Math.abs(b.elevation - a.elevation);
          if (rise < 1.5 || Math.max(a.elevation, b.elevation) < 4) continue;
          const clear = Array.from({ length: 21 }, (_, i) => globalThis.__browserCheckPose(game.network.pointOnRoad(road.id, from + span * i / 20)))
            .every(point => !game.world.terrain.isWater(point.x, point.y) && game._vehicleFree({ ...game.cars[0], ...point, orientation: null, upright: true }));
          if (!clear) continue;
          const forward = b.elevation > a.elevation, start = forward ? a : b, end = forward ? b : a;
          candidates.push({ roadId: road.id, start: { ...start, angle: start.angle + (forward ? 0 : Math.PI) }, end, rise, span });
        }
      }
      candidates.sort((a, b) => b.rise - a.rise);
      if (!candidates.length) throw new Error('The imported map needs a clear graded hill road with a meaningful height change.');
      return candidates[0];
    };
  });
}

async function installAudioInspection(context) {
  await context.addInitScript(() => {
    const connect = AudioNode.prototype.connect, taps = new Map();
    // Measure the samples Chrome actually sends to its destination. The real
    // context, oscillators, effects, gains and output stay in the signal path.
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination !== this.context.destination) return connect.call(this, destination, ...args);
      let tap = taps.get(this.context);
      if (!tap) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0;
        connect.call(analyser, destination);
        tap = { analyser, samples: new Float32Array(analyser.fftSize) };
        taps.set(this.context, tap);
      }
      connect.call(this, tap.analyser, ...args);
      return destination;
    };
    globalThis.__browserCheckAudioOutput = {
      read() {
        let sum = 0, count = 0;
        for (const [context, tap] of taps) {
          if (context.state !== 'running') continue;
          tap.analyser.getFloatTimeDomainData(tap.samples);
          for (const sample of tap.samples) { sum += sample * sample; count++; }
        }
        return { rms: count ? Math.sqrt(sum / count) : 0, contexts: taps.size,
          states: Array.from(taps.keys(), context => context.state) };
      },
    };
  });
}

async function audioState(page) {
  return page.evaluate(() => globalThis.__browserCheckAudioDirector.getStatus());
}

async function measureAudio(page, milliseconds = 280) {
  return page.evaluate(async duration => {
    const samples = [], end = performance.now() + duration;
    do {
      samples.push(globalThis.__browserCheckAudioOutput.read().rms);
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (performance.now() < end);
    return { ...globalThis.__browserCheckAudioOutput.read(),
      rms: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      peakRms: Math.max(...samples), samples: samples.length };
  }, milliseconds);
}

async function setAudioRange(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, level) => {
    input.value = String(level);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function checkAudio(browser, externalRequests) {
  const context = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
  try {
    await installEngineInspection(context);
    await installAudioInspection(context);
    await context.route('**/*', route => {
      if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    assert.equal((await audioState(page)).state, 'locked', 'Music must wait for the Play gesture.');
    assert.equal((await measureAudio(page, 80)).contexts, 0, 'The welcome screen must not create an audio context.');
    // Remove nearby ambient engines and residents from this isolated listening
    // scenario; the real simulation, input and WebAudio synthesis stay active.
    await page.evaluate(() => {
      const game = globalThis.__browserCheckGame;
      game.cars = [game.cars[0]]; game.cars[0].traffic = false; game.peds = []; game.heat = 0; game.graceTimer = 60;
      for (const cop of game.police) { cop.x = 100; cop.y = 100; cop.route = []; cop.distracted = 60; }
    });
    await page.locator('#play-button').click();
    await waitForScene(page, 'foot');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().state === 'running' && globalThis.__browserCheckAudioDirector.getStatus().active);
    await page.waitForFunction(() => {
      const audio = globalThis.__browserCheckAudioDirector.getStatus();
      return audio.sampleCount === 7 && audio.loadingSamples === 0;
    }, null, { timeout: 15000 });
    const foot = await audioState(page), footOutput = await measureAudio(page);
    assert.equal(foot.failedSamples, 0, 'All seven locally embedded generated samples must decode in Chrome.');
    assert.equal(foot.mode, 'foot'); assert.equal(foot.station, 'foot');
    assert.ok(footOutput.rms > 0.00001, 'Foot music must produce real nonzero Chrome audio samples.');
    await page.keyboard.press('e');
    await waitForScene(page, 'drive');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().mode === 'vehicle' && globalThis.__browserCheckAudioDirector.getStatus().engineSampleCount > 0);
    assert.equal((await audioState(page)).station, 'biscuit');
    assert.ok((await measureAudio(page)).rms > 0.00001, 'The vehicle engine and radio must reach the audio destination.');
    await page.keyboard.press('n');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().station === 'neon');
    await page.keyboard.press('b');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().station === 'biscuit');
    await page.locator('#radio-next').click();
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().station === 'neon');
    await page.locator('#radio-previous').click();
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().station === 'biscuit');
    assert.ok((await page.locator('#radio-status').textContent()).trim().length > 0, 'The radio must identify the selected station.');
    for (let change = 0; change < 12; change++) await page.keyboard.press('n');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().station === 'biscuit');
    await page.waitForTimeout(350);
    const vehicle = await audioState(page);
    assert.ok(vehicle.generatedVoiceCount > 0, 'The vehicle must use decoded generated engine audio.');
    assert.ok(vehicle.voiceCount <= 80, 'Repeated station changes must keep audio voices bounded.');
    assert.equal((await measureAudio(page, 80)).contexts, 1, 'Station changes must reuse the original audio context.');
    await page.screenshot({ path: path.join(evidence, 'audio-radio.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    for (const id of ['radio-panel', 'radio-previous', 'radio-next']) assert.equal(await page.locator(`#${id}`).isVisible(), true);
    await page.screenshot({ path: path.join(evidence, 'audio-radio-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.locator('#game-canvas').focus();
    for (let step = 0; step < 3; step++) await page.keyboard.press('n');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().station === 'off' && globalThis.__browserCheckAudioDirector.getStatus().musicVoiceCount === 0);
    assert.ok((await audioState(page)).engineCount > 0, 'Radio off must retain the player engine without substituting foot music.');
    const engineOutput = await measureAudio(page);
    assert.ok(engineOutput.rms > 0.00001, 'Radio off must leave the real vehicle engine audible.');
    await page.keyboard.press('h');
    await page.waitForFunction(() => {
      const audio = globalThis.__browserCheckAudioDirector.getStatus();
      return audio.generatedVoiceCount > audio.engineSampleCount + audio.sirenSampleCount;
    }, null, { timeout: 2000 });
    const horn = await audioState(page), hornOutput = await measureAudio(page, 140);
    assert.ok(hornOutput.peakRms > 0.00001, 'The generated horn must reach Chrome audio output through the real horn action.');
    await page.waitForFunction(() => {
      const audio = globalThis.__browserCheckAudioDirector.getStatus();
      return audio.generatedVoiceCount === audio.engineSampleCount + audio.sirenSampleCount;
    }, null, { timeout: 2000 });
    // Exercise the real crash feedback/event path independently of the physical
    // contact regressions elsewhere in this suite, then observe native output.
    await page.evaluate(() => {
      const game = globalThis.__browserCheckGame;
      game.graceTimer = 0; game._impactCooldown = 0; game._impact(game.current, 100, false);
    });
    await page.waitForFunction(() => {
      const audio = globalThis.__browserCheckAudioDirector.getStatus();
      return audio.generatedVoiceCount > audio.engineSampleCount + audio.sirenSampleCount;
    }, null, { timeout: 2000 });
    const crashOutput = await measureAudio(page, 140);
    assert.ok(crashOutput.peakRms > 0.00001, 'The generated crash must reach native output when core crash feedback is drained.');
    await page.keyboard.press('n');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().station === 'biscuit');

    await page.locator('#sound-toggle').click();
    await page.waitForTimeout(240);
    const muted = await measureAudio(page);
    assert.ok(muted.peakRms < 0.000001, `Mute must silence existing sources, measured ${muted.peakRms}.`);
    assert.equal((await audioState(page)).generatedVoiceCount, 0, 'Mute must release generated samples as well as synthesized voices.');
    await page.locator('#sound-toggle').click();
    await page.waitForTimeout(180);
    assert.ok((await measureAudio(page)).rms > 0.00001, 'Unmuting must restore playback.');
    await page.keyboard.press('p');
    await page.locator('#pause-screen').waitFor({ state: 'visible' });
    await page.waitForTimeout(240);
    const paused = await audioState(page), pausedOutput = await measureAudio(page);
    assert.equal(paused.active, false);
    assert.equal(paused.voiceCount, 0, 'Pausing must stop and release scheduled audio voices.');
    assert.equal(paused.generatedVoiceCount, 0);
    assert.ok(pausedOutput.peakRms < 0.000001, 'Pausing must silence the engine and radio.');
    await page.locator('#resume-button').click();
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().active);
    for (let restart = 0; restart < 3; restart++) {
      await page.keyboard.press('p');
      await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().voiceCount === 0);
      await page.locator('#resume-button').click();
      await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().active);
    }

    await page.evaluate(() => {
      const game = globalThis.__browserCheckGame, car = game.current, cop = game.police[0];
      game.heat = 2; game.escapeTimer = 0; game.graceTimer = 60;
      Object.assign(cop, { x: car.x + Math.cos(car.angle) * 110, y: car.y + Math.sin(car.angle) * 110,
        angle: car.angle, speed: 0, vx: 0, vy: 0, distracted: 60, route: [], routeTimer: 5, lastSeen: { x: car.x, y: car.y } });
      game.vehiclePhysics.reset(cop);
    });
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().sirenSampleCount > 0);
    const chase = await audioState(page), chaseOutput = await measureAudio(page);
    assert.ok(chase.sirenCount <= 3 && chase.engineCount <= 5, 'Nearby audio voices must remain bounded.');
    assert.ok(chase.generatedVoiceCount >= chase.engineSampleCount + chase.sirenSampleCount, 'Nearby engine and siren loops must use decoded generated samples.');
    assert.ok(chaseOutput.rms > 0.00001, 'Active sirens must produce destination audio.');
    await page.evaluate(() => {
      const game = globalThis.__browserCheckGame; game.heat = 0;
      for (const cop of game.police) { cop.x = 100; cop.y = 100; game.vehiclePhysics.reset(cop); }
      game.current.speed = game.current.vx = game.current.vy = 0; game.vehiclePhysics.reset(game.current);
    });
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().sirenCount === 0);
    await page.locator('#game-canvas').focus();
    await page.keyboard.press('e');
    await waitForScene(page, 'foot');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().mode === 'foot' && globalThis.__browserCheckAudioDirector.getStatus().station === 'foot');

    await page.locator('#help-toggle').click();
    await page.locator('#help-screen').waitFor({ state: 'visible' });
    await setAudioRange(page, 'audio-music', 0);
    await setAudioRange(page, 'audio-effects', 1);
    await page.locator('#close-help').click();
    await page.waitForTimeout(450);
    assert.ok((await measureAudio(page, 80)).peakRms < 0.000001, 'Music level zero must silence the isolated on-foot scene.');
    await page.locator('#game-canvas').focus();
    await page.keyboard.press('Space');
    const effect = await measureAudio(page, 120);
    assert.ok(effect.peakRms > 0.00001, 'Jump effects must produce real audio when music is disabled.');
    await captureMouse(page);
    await fireToy(page);
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().generatedVoiceCount > 0, null, { timeout: 2000 });
    const pop = await audioState(page), popOutput = await measureAudio(page, 140);
    assert.ok(popOutput.peakRms > 0.00001, 'The generated pop sample must reach native output through the real toy action.');

    await page.locator('#help-toggle').click();
    await page.locator('#help-screen').waitFor({ state: 'visible' });
    await setAudioRange(page, 'audio-master', 0.75);
    await setAudioRange(page, 'audio-music', 0.45);
    await setAudioRange(page, 'audio-effects', 0.65);
    await page.locator('#radio-station').selectOption('meadow');
    for (const [id, level] of [['audio-master-value', 75], ['audio-music-value', 45], ['audio-effects-value', 65]])
      assert.match(await page.locator(`#${id}`).textContent(), new RegExp(String(level)));
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).settings, saveKey);
    assert.equal(saved.muted, false);
    for (const [key, value] of Object.entries({ masterVolume: 0.75, musicVolume: 0.45, effectsVolume: 0.65, radioStation: 'meadow' }))
      assert.equal(saved.audio[key], value);
    await page.locator('.audio-settings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, 'audio-settings.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#radio-station').scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    for (const id of ['audio-master', 'audio-music', 'audio-effects', 'radio-station']) assert.equal(await page.locator(`#${id}`).isVisible(), true);
    await page.screenshot({ path: path.join(evidence, 'audio-settings-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.reload();
    assert.equal((await audioState(page)).state, 'locked', 'Reload must preserve the user-gesture playback gate.');
    for (const [id, level] of [['audio-master', '0.75'], ['audio-music', '0.45'], ['audio-effects', '0.65']])
      assert.equal(await page.locator(`#${id}`).inputValue(), level);
    assert.equal(await page.locator('#radio-station').inputValue(), 'meadow');
    await page.locator('#play-button').click();
    await waitForScene(page, 'foot');
    await page.keyboard.press('e');
    await waitForScene(page, 'drive');
    await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().station === 'meadow');
    diagnostics.audio = { foot, footOutput, vehicle, engineOutput, horn, hornOutput, crashOutput, muted, paused, pausedOutput,
      chase, chaseOutput, effect, pop, popOutput, saved, reloaded: await audioState(page) };
  } finally { await closeTestContext(context); }
}

async function checkUnavailableAudio(browser, externalRequests) {
  const context = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
  try {
    await installEngineInspection(context);
    await context.addInitScript(() => {
      for (const name of ['AudioContext', 'webkitAudioContext']) Object.defineProperty(globalThis, name, { value: undefined, configurable: true });
    });
    await context.route('**/*', route => {
      if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.locator('#play-button').click();
    await waitForScene(page, 'foot');
    assert.equal((await audioState(page)).state, 'unavailable');
    assert.match(await page.locator('#sound-toggle').textContent(), /unavailable/i);
    await page.keyboard.press('e');
    await waitForScene(page, 'drive');
    await page.locator('#help-toggle').click();
    await page.locator('#help-screen').waitFor({ state: 'visible' });
    await setAudioRange(page, 'audio-master', 0.5);
    assert.equal(await page.locator('#audio-master').inputValue(), '0.5');
    await page.locator('#close-help').click();
    assert.equal(await page.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
    assert.equal((await audioState(page)).voiceCount, 0, 'Unavailable audio must leave gameplay usable without audio voices.');
  } finally { await closeTestContext(context); }
}

async function withTerrainPage(browser, externalRequests, action) {
  const context = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
  try {
    await installEngineInspection(context);
    await context.route('**/*', route => {
      if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.locator('#play-button').click();
    await waitForScene(page, 'foot');
    await captureMouse(page);
    await action(page);
  } finally { await closeTestContext(context); }
}

async function checkSharedTerrain(page) {
  await waitForMinimap(page);
  const terrain = await page.evaluate(() => {
    const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene, field = game.world.terrain, T = scene.T;
    const positions = scene._terrainMesh.geometry.getAttribute('position'), waterBounds = new T.Box3().setFromObject(scene._riverSurface);
    const vertexMatches = [0, field.count - 1, Math.floor(field.heights.length / 3), Math.floor(field.heights.length / 2), field.heights.length - 1]
      .every(index => Math.abs(positions.getY(index) - field.heights[index]) < 0.00001 &&
        Math.abs(positions.getX(index) * 20 - index % field.count * field.step) < 0.01 &&
        Math.abs(positions.getZ(index) * 20 - Math.floor(index / field.count) * field.step) < 0.01);
    const hill = globalThis.__browserCheckHill(), origin = hill.start;
    scene.scene.updateMatrixWorld(true);
    const ray = new T.Raycaster(new T.Vector3(origin.x / 20, origin.elevation + 100, origin.y / 20), new T.Vector3(0, -1, 0));
    const groundHit = ray.intersectObject(scene._terrainMesh, false)[0];
    const canvas = document.getElementById('minimap-canvas'), pixels = canvas.getContext('2d');
    const sample = point => {
      const x = Math.round(point.x / game.world.size * canvas.width), y = Math.round(point.y / game.world.size * canvas.width);
      const values = pixels.getImageData(x - 1, y - 1, 3, 3).data, color = [0, 0, 0];
      for (let i = 0; i < values.length; i += 4) for (let channel = 0; channel < 3; channel++) color[channel] += values[i + channel] / 9;
      return { point, color };
    };
    let dry;
    for (let y = 200; y < field.mapHeight && !dry; y += 200) for (let x = 200; x < field.mapWidth; x += 200) {
      if (field.heightAt(x, y) > 5 && game.network.project({ x, y }).distance > 250 &&
        !game.buildings.some(building => Math.hypot(x - building.x - building.w / 2, y - building.y - building.h / 2) < 250)) { dry = { x, y }; break; }
    }
    const sea = { x: game.world.size / 2, y: game.world.size - 600 };
    return { info: scene.worldInfo, sourceBitDepth: field.sourceBitDepth, importedBitDepth: globalThis.MayhemHeightData.sourceBitDepth, sourceSha256: field.sourceSha256,
      size: game.world.size, mapWidth: field.mapWidth, mapHeight: field.mapHeight, count: field.count,
      vertices: positions.count, triangles: scene._terrainMesh.geometry.index.count / 3, vertexMatches,
      physicalGrid: game.vehiclePhysics.heightfield.data.length, physicalFloorKind: game.vehiclePhysics.floor.kind,
      visibleHillHeight: groundHit?.point.y, expectedHillHeight: field.heightAt(origin.x, origin.y), hill,
      waterBounds: { min: waterBounds.min.toArray(), max: waterBounds.max.toArray() }, waterLevel: field.waterLevel,
      mapDry: dry && sample(dry), mapSea: sample(sea), seaIsWater: field.isWater(sea.x, sea.y) };
  });
  assert.equal(terrain.sourceBitDepth, terrain.importedBitDepth); assert.ok([8, 16].includes(terrain.sourceBitDepth)); assert.match(terrain.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(terrain.size, 12000); assert.equal(terrain.mapWidth, 12000); assert.equal(terrain.mapHeight, 8000);
  assert.equal(terrain.vertices, terrain.count ** 2); assert.equal(terrain.triangles, (terrain.count - 1) ** 2 * 2);
  assert.equal(terrain.physicalGrid, terrain.count); assert.equal(terrain.physicalFloorKind, 'terrain'); assert.equal(terrain.vertexMatches, true);
  assert.ok(Math.abs(terrain.visibleHillHeight - terrain.expectedHillHeight) < 0.01, 'Actual visible triangles must agree with the shared physical terrain height at a hill point.');
  assert.ok(terrain.info.landscape.maxElevation - terrain.info.landscape.minElevation > 20 && terrain.info.landscape.minElevation < 0);
  assert.ok(terrain.waterBounds.min[0] <= 0 && terrain.waterBounds.max[0] >= terrain.size / 20 && Math.abs(terrain.waterBounds.max[1] - terrain.waterLevel) < 0.1);
  assert.equal(terrain.seaIsWater, true); assert.ok(terrain.mapDry);
  assert.ok(terrain.mapSea.color[2] > terrain.mapSea.color[0] + 25, 'The minimap must draw the real ocean mask in blue.');
  assert.ok(terrain.mapDry.color[1] > terrain.mapDry.color[2] + 5, 'The minimap must draw real elevated land distinctly from the water.');
  diagnostics.sharedTerrain = terrain;
  await captureNetworkOverview(page);
}

async function checkHillWalking(page) {
  const hill = await page.evaluate(() => {
    const game = globalThis.__browserCheckGame, fixture = globalThis.__browserCheckHill();
    game.cars = []; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0; game.graceTimer = 120;
    Object.assign(game.player, { ...fixture.start, vehicleId: null, verticalVelocity: 0, grounded: true, ragdollGrace: 0 });
    return fixture;
  });
  await page.keyboard.press('c'); await waitForFreshFrames(page);
  const before = await sceneState(page);
  await page.keyboard.down('w');
  try { await page.waitForTimeout(650); } finally { await page.keyboard.up('w'); }
  const walked = await page.evaluate(() => {
    const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene, player = game.player;
    return { x: player.x, y: player.y, elevation: player.elevation, ground: globalThis.__browserCheckGround(player), grounded: player.grounded,
      renderedHeight: scene._player.group.position.y, cameraHeight: scene.camera.position.y,
      cameraGround: game.world.terrain.surfaceHeight(scene.camera.position.x * 20, scene.camera.position.z * 20) };
  });
  assert.ok(Math.hypot(walked.x - before.worldX, walked.y - before.worldY) > 12, 'Real walking input must advance uphill.');
  assert.ok(Math.abs(walked.ground - hill.start.elevation) > 0.015, 'Walking must follow a changing hill surface.');
  assert.ok(walked.grounded && Math.abs(walked.elevation - walked.ground) < 0.08);
  assert.ok(Math.abs(walked.renderedHeight - walked.elevation) < 0.1 && walked.cameraHeight > walked.cameraGround + 0.1);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => { const player = globalThis.__browserCheckGame.player; return player.elevation - globalThis.__browserCheckGround(player) > 1; }, null, { timeout: 1500 });
  const airborne = await page.evaluate(() => ({ elevation: globalThis.__browserCheckGame.player.elevation,
    ground: globalThis.__browserCheckGround(globalThis.__browserCheckGame.player), renderedHeight: globalThis.__browserCheckScene._player.group.position.y }));
  assert.ok(airborne.renderedHeight - airborne.ground > 1);
  await page.waitForFunction(() => { const player = globalThis.__browserCheckGame.player; return player.grounded && Math.abs(player.elevation - globalThis.__browserCheckGround(player)) < 0.08; }, null, { timeout: 2500 });
  await page.keyboard.press('f');
  await page.waitForFunction(() => Boolean(globalThis.__browserCheckGame.physics.get('player')));
  await page.waitForTimeout(900);
  const fallen = await bodyState(page); assertFiniteBody(fallen);
  assert.ok(fallen.joints.head.y > fallen.groundHeight - 0.5, 'The articulated body must collide with the elevated hill, not fall to a zero-height floor.');
  await page.waitForFunction(() => !globalThis.__browserCheckGame.physics.get('player'), null, { timeout: 10000 });
  const recovered = await page.evaluate(() => { const player = globalThis.__browserCheckGame.player;
    return { x: player.x, y: player.y, elevation: player.elevation, ground: globalThis.__browserCheckGround(player), grounded: player.grounded }; });
  assert.ok(recovered.grounded && recovered.elevation > 3 && Math.abs(recovered.elevation - recovered.ground) < 0.1, 'Automatic get-up must restore standing feet on the hill.');
  assert.ok(Math.hypot(recovered.x - walked.x, recovered.y - walked.y) < 150, 'Automatic get-up must remain beside the hill tumble.');
  for (let turn = 0; turn < 4; turn++) {
    await lookCamera(page, 260, turn === 0 ? 65 : 0);
    const camera = await page.evaluate(() => { const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
      return { y: scene.camera.position.y, ground: game.world.terrain.surfaceHeight(scene.camera.position.x * 20, scene.camera.position.z * 20) }; });
    assert.ok(camera.y > camera.ground + 0.08, 'The live camera must remain above the actual hill as it orbits.');
  }
  await page.keyboard.press('c');
  await page.waitForFunction(() => { const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
    return Math.abs(Math.atan2(Math.sin(scene.viewYaw - game.player.angle), Math.cos(scene.viewYaw - game.player.angle))) < 0.05; });
  await page.waitForTimeout(300);
  await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('toast')).opacity) === 0, null, { timeout: 6000 });
  await page.screenshot({ path: path.join(evidence, 'desktop-terrain-hill-street.png'), fullPage: true });
  diagnostics.hillWalking = { hill, walked, airborne, recovered };
}

async function checkHillDriving(page) {
  const hill = await page.evaluate(() => {
    const game = globalThis.__browserCheckGame, fixture = globalThis.__browserCheckHill(), car = game.cars[0];
    game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0; game.graceTimer = 120;
    Object.assign(car, { ...fixture.start, traffic: false, speed: 0, vx: 0, vy: 0, orientation: null }); game.vehiclePhysics.reset(car, car);
    const side = { x: car.x - Math.sin(car.angle) * 32, y: car.y + Math.cos(car.angle) * 32 };
    Object.assign(game.player, { ...globalThis.__browserCheckPose(side), angle: car.angle, vehicleId: null, grounded: true, verticalVelocity: 0 });
    return fixture;
  });
  await page.keyboard.press('c'); await page.keyboard.press('e'); await waitForScene(page, 'drive');
  const trace = {};
  await driveNetworkRoute(page, hill.end, trace);
  const car = await vehicleState(page); assertRenderedVehicle(car);
  assert.ok(car.elevation - hill.start.elevation > 1.2, 'Actual throttle and steering must climb a physically graded hill.');
  assert.ok(trace.samples.every(sample => sample.elevation > sample.groundHeight - 0.25 && sample.elevation < sample.groundHeight + 1.0), 'The real car body must stay supported by terrain during the climb.');
  assert.ok(car.upright && Math.abs(car.elevation - car.groundHeight) < 0.35 && car.health > 90);
  diagnostics.hillDriving = { hill, trace, car };
  await page.keyboard.press('c');
  await page.waitForFunction(() => { const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
    return Math.abs(Math.atan2(Math.sin(scene.viewYaw - game.current.angle), Math.cos(scene.viewYaw - game.current.angle))) < 0.05; });
  await page.waitForTimeout(300);
  await page.waitForFunction(() => Number(getComputedStyle(document.getElementById('toast')).opacity) === 0, null, { timeout: 6000 });
  await page.screenshot({ path: path.join(evidence, 'desktop-terrain-hill-driving.png'), fullPage: true });
}

async function checkBridgeDriving(page) {
  const bridge = await page.evaluate(() => {
    const game = globalThis.__browserCheckGame, car = game.cars[0];
    const bridges = game.roads.filter(road => road.bridge && road.points.some(point => game.world.terrain.isWater(point.x, point.y)));
    const road = bridges.find(road => road.id === 'bridge-city') || bridges[0];
    if (!road) throw new Error('The attached map must provide a physical city-to-airport bridge over water.');
    game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0; game.graceTimer = 120;
    const start = globalThis.__browserCheckPose(game.network.pointOnRoad(road.id, 30));
    const end = globalThis.__browserCheckPose(game.network.pointOnRoad(road.id, road.length - 30));
    Object.assign(car, { ...start, traffic: false, speed: 0, vx: 0, vy: 0, orientation: null }); game.vehiclePhysics.reset(car, car);
    const side = { x: car.x - Math.sin(car.angle) * 32, y: car.y + Math.cos(car.angle) * 32 };
    Object.assign(game.player, { ...globalThis.__browserCheckPose(side), angle: car.angle, vehicleId: null, grounded: true, verticalVelocity: 0 });
    globalThis.__terrainBridgeContacts = 0;
    car && game.vehiclePhysics.get(car.id).addEventListener('collide', event => { if (event.body.kind === 'bridge') globalThis.__terrainBridgeContacts++; });
    return { roadId: road.id, start, end, length: road.length, physicalDecks: game.vehiclePhysics.bridgeBodies.length,
      renderedDecks: globalThis.__browserCheckScene._bridgeUndersides.count };
  });
  assert.ok(bridge.physicalDecks > 0 && bridge.renderedDecks > 0, 'The bridge needs actual Cannon deck solids and visible supporting geometry.');
  await page.keyboard.press('c'); await page.keyboard.press('e'); await waitForScene(page, 'drive');
  const trace = {};
  await driveNetworkRoute(page, bridge.end, trace);
  const wetSamples = trace.samples.filter(sample => sample.water);
  assert.ok(wetSamples.length > 4, 'Real keyboard driving must travel across the water span.');
  assert.ok(wetSamples.every(sample => sample.groundHeight > 1 && sample.elevation > sample.groundHeight - 0.25 && sample.elevation < sample.groundHeight + 0.8), 'The real car must be carried by the bridge deck above the seabed and water.');
  assert.ok(await page.evaluate(() => globalThis.__terrainBridgeContacts > 0), 'The crossing must produce actual Cannon bridge contacts.');
  const car = await vehicleState(page); assertRenderedVehicle(car);
  assert.ok(car.upright && car.health > 90 && Math.hypot(car.x - bridge.end.x, car.y - bridge.end.y) < 42);
  diagnostics.bridgeDriving = { bridge, trace, car, contacts: await page.evaluate(() => globalThis.__terrainBridgeContacts) };
}

async function checkElevatedGarage(page) {
  const visit = await page.evaluate(() => {
    const game = globalThis.__browserCheckGame, fixture = globalThis.__browserCheckService(), car = game.cars[0];
    game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0; game.graceTimer = 120;
    Object.assign(car, { ...fixture.car, traffic: false, speed: 0, vx: 0, vy: 0, orientation: null }); game.vehiclePhysics.reset(car, car);
    Object.assign(game.player, { ...fixture.player, vehicleId: null, verticalVelocity: 0, grounded: true });
    return { garage: fixture.garage, player: fixture.player, car: fixture.car };
  });
  assert.ok(visit.player.elevation > 0.2, 'The service visit must exercise a raised local floor.');
  await page.keyboard.press('e'); await waitForScene(page, 'drive');
  await openInventory(page, true);
  assert.equal(await page.locator('#store-car').isDisabled(), false, 'The raised garage must allow storing a stopped upright car.');
  await closeInventory(page);
  await captureMouse(page); await page.keyboard.press('e'); await waitForScene(page, 'foot');
  const player = await page.evaluate(() => { const game = globalThis.__browserCheckGame;
    return { elevation: game.player.elevation, ground: globalThis.__browserCheckGround(game.player), free: game._isFree(game.player.x, game.player.y, globalThis.MayhemPhysics.PLAYER_RADIUS) }; });
  assert.ok(player.free && Math.abs(player.elevation - player.ground) < 0.15, 'Car exit must place feet on the raised local terrain.');
  diagnostics.elevatedGarage = { visit, player };
}

async function checkSampleFallback(browser, externalRequests) {
  const results = {};
  for (const scenario of ['missing', 'corrupt']) {
    const context = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
    try {
      await installEngineInspection(context);
      await installAudioInspection(context);
      // Override only this isolated page's embedded data. Its locally loaded
      // script, real audio decoder and synthesized fallback run normally.
      await context.addInitScript(mode => {
        let samples;
        Object.defineProperty(globalThis, 'MayhemAudioSamples', { configurable: true,
          get() { return samples; },
          set(value) {
            samples = mode === 'missing' ? undefined : Object.fromEntries(Object.entries(value).map(([id, entry]) =>
              [id, { ...entry, data: 'AAAA' }]));
          },
        });
      }, scenario);
      await context.route('**/*', route => {
        if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
        externalRequests.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(url);
      await page.evaluate(() => {
        const game = globalThis.__browserCheckGame;
        game.cars = [game.cars[0]]; game.cars[0].traffic = false; game.peds = []; game.heat = 0; game.graceTimer = 60;
        for (const cop of game.police) { cop.x = 100; cop.y = 100; cop.route = []; cop.distracted = 60; }
      });
      await page.locator('#play-button').click();
      await waitForScene(page, 'foot');
      await page.waitForFunction(expected => {
        const audio = globalThis.__browserCheckAudioDirector.getStatus();
        return audio.state === 'running' && audio.active && audio.loadingSamples === 0 && audio.failedSamples === expected;
      }, scenario === 'corrupt' ? 7 : 0, { timeout: 15000 });
      const foot = await audioState(page), footOutput = await measureAudio(page);
      assert.equal(foot.sampleCount, 0);
      assert.equal(foot.generatedVoiceCount, 0);
      assert.ok(footOutput.rms > 0.00001, `${scenario} samples must retain audible local synthesized music.`);
      await page.keyboard.press('e');
      await waitForScene(page, 'drive');
      await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().engineCount > 0);
      const vehicle = await audioState(page);
      assert.equal(vehicle.engineSampleCount, 0);
      assert.equal(vehicle.generatedVoiceCount, 0);
      await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, car = game.current, cop = game.police[0];
        game.heat = 1; game.escapeTimer = 0; game.graceTimer = 60;
        Object.assign(cop, { x: car.x + Math.cos(car.angle) * 110, y: car.y + Math.sin(car.angle) * 110,
          angle: car.angle, speed: 0, vx: 0, vy: 0, distracted: 60, route: [], routeTimer: 5, lastSeen: { x: car.x, y: car.y } });
        game.vehiclePhysics.reset(cop);
      });
      await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().sirenCount > 0);
      const chase = await audioState(page), chaseOutput = await measureAudio(page);
      assert.equal(chase.sirenSampleCount, 0);
      assert.equal(chase.generatedVoiceCount, 0);
      assert.ok(chaseOutput.rms > 0.00001, `${scenario} samples must retain audible engine and siren fallback.`);
      await page.keyboard.press('p');
      await page.waitForFunction(() => globalThis.__browserCheckAudioDirector.getStatus().voiceCount === 0);
      // Voices are removed immediately, while gain ramps and the analyser's
      // recent sample window still include the brief native output tail.
      await page.waitForTimeout(240);
      const pausedOutput = await measureAudio(page);
      assert.ok(pausedOutput.peakRms < 0.000001, `${scenario} fallback pause must settle to silence, measured RMS ${pausedOutput.peakRms}.`);
      results[scenario] = { foot, footOutput, vehicle, chase, chaseOutput, pausedOutput };
    } finally { await closeTestContext(context); }
  }
  diagnostics.audioFallback = results;
}

async function bodyState(page, id = 'player') {
  return page.evaluate(bodyId => {
    const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
    const body = game.physics.get(bodyId);
    if (!body) return null;
    return {
      age: body.age, phase: body.phase, recovery: body.recovery,
      joints: Object.fromEntries(Object.entries(body.joints).map(([name, point]) => [name, { x: point.x, y: point.y, z: point.z }])),
      normalVisible: bodyId === 'player' ? scene._player.group.visible : scene._residents.get(bodyId)?.group.visible,
      renderedBodies: scene.ragdollCount, renderedHeads: scene._ragdollHeads.count,
      renderedSegments: scene._ragdollCubes.count,
      matrices: Array.from(scene._ragdollCubes.instanceMatrix.array.slice(0, scene._ragdollCubes.count * 16)),
      playerAngle: game.player.angle, vehicleId: game.player.vehicleId, actionCooldown: game._actionCooldown,
      groundHeight: globalThis.__browserCheckGround(game.player),
    };
  }, id);
}

async function vehicleState(page, id) {
  return page.evaluate(vehicleId => {
    const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
    const car = vehicleId ? game.cars.find(entity => entity.id === vehicleId) : game.current;
    const entry = game.vehiclePhysics.bodies.get(car.id), model = scene._vehicles.get(car.id);
    const body = entry.body;
    return {
      id: car.id, x: car.x, y: car.y, elevation: car.elevation, speed: car.speed,
      groundHeight: globalThis.__browserCheckGround(car),
      vx: car.vx, vy: car.vy, verticalVelocity: car.verticalVelocity,
      health: car.health, upright: car.upright, grounded: car.grounded,
      orientation: { ...car.orientation }, angularVelocity: { ...car.angularVelocity },
      bodyPosition: { x: body.position.x, y: body.position.y, z: body.position.z },
      bodyQuaternion: { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w },
      bodyVelocity: { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z },
      bodyAngularVelocity: { x: body.angularVelocity.x, y: body.angularVelocity.y, z: body.angularVelocity.z },
      renderedHeight: model.group.position.y,
      renderedQuaternion: { x: model.group.quaternion.x, y: model.group.quaternion.y, z: model.group.quaternion.z, w: model.group.quaternion.w },
      contacts: [...(globalThis.__browserCheckContacts || [])],
    };
  }, id);
}

function assertRenderedVehicle(state) {
  assert.ok([state.x, state.y, state.elevation, state.renderedHeight, ...Object.values(state.bodyPosition), ...Object.values(state.orientation)].every(Number.isFinite), 'Physical and rendered vehicle coordinates must stay finite.');
  const dot = Math.abs(['x', 'y', 'z', 'w'].reduce((sum, key) => sum + state.renderedQuaternion[key] * state.bodyQuaternion[key], 0));
  assert.ok(dot > 0.999, `Visible car must follow the actual physical quaternion; alignment ${dot.toFixed(4)}.`);
  assert.ok(state.renderedHeight >= state.elevation - 0.05, 'The rendered body must rise with its physical elevation.');
}

function assertFiniteBody(body) {
  assert.ok(body, 'Expected a physical ragdoll body.');
  assert.equal(Object.keys(body.joints).length, 15, 'Every body needs fifteen simulated joints.');
  assert.ok(Object.values(body.joints).every(point => Object.values(point).every(Number.isFinite)), 'All joint coordinates must be finite.');
  assert.ok(body.matrices.every(Number.isFinite), 'Rendered joint transforms must be finite.');
  assert.equal(body.normalVisible, false, 'Standing avatar must give way to the articulated physical pose.');
  assert.ok(body.renderedHeads > 0 && body.renderedSegments >= 18, 'Renderer must draw physical head and limb segments.');
}

async function inventoryState(page) {
  return page.evaluate(() => {
    const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
    return {
      time: game.time, money: game.money, composure: game.player.composure,
      player: { x: game.player.x, y: game.player.y, vehicleId: game.player.vehicleId },
      inventory: JSON.parse(JSON.stringify(game.inventory)),
      garage: JSON.parse(JSON.stringify(game.garage)),
      equippedModel: scene._player.equipped,
      visibleToys: Object.entries(scene._player.toys || {}).filter(([, group]) => group.visible).map(([id]) => id),
      projectiles: game.projectiles.length, renderedShots: scene._toyShots?.count || 0,
      missionTime: game.missionStats.elapsed,
      bodies: [...game.physics.bodies.values()].map(body => ({ id: body.id, age: body.age })),
    };
  });
}

async function openInventory(page, collection = false) {
  if (await page.locator('#inventory-screen').isVisible()) {
    await page.locator(collection ? '#collection-tab' : '#pockets-tab').click();
  } else {
    await page.keyboard.press(collection ? 'g' : 'i');
    await page.locator('#inventory-screen').waitFor({ state: 'visible' });
  }
}

async function closeInventory(page) {
  await page.locator('#close-inventory').click();
  await page.locator('#inventory-screen').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
}

async function equipWithWheel(page, digit) {
  await page.keyboard.down('Tab');
  await page.locator('#toy-wheel').waitFor({ state: 'visible' });
  await page.keyboard.press(String(digit));
  await page.keyboard.up('Tab');
  await page.locator('#toy-wheel').waitFor({ state: 'hidden' });
  await waitForFreshFrames(page);
}

async function check(name, action) {
  if (checkFilter && !checkFilter.test(name) && !name.startsWith('no ')) return;
  try {
    await action();
    checks.push({ name, passed: true });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    checks.push({ name, passed: false, error: error.message, stack: error.stack });
    process.stdout.write(`FAIL ${name}: ${error.message}\n`);
  }
}

async function main() {
  if (!fs.existsSync(path.join(project, 'core.js'))) throw new Error('core.js is missing from this project.');
  fs.mkdirSync(evidence, { recursive: true });
  const { chromium } = loadPlaywright();
  // Software WebGL keeps this optional check usable on headless Windows hosts.
  const launch = { headless: true, args: ['--enable-unsafe-swiftshader'] };
  const chrome = process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (fs.existsSync(chrome)) launch.executablePath = chrome;
  else throw new Error('Chrome executable not found. Set BROWSER_EXECUTABLE to your Chrome path.');
  const browser = await chromium.launch(launch);
  try {
    const context = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await installEngineInspection(context);
    const page = await context.newPage();
    const externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await context.route('**/*', route => {
      if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
      externalRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(url);
    await check('no native pointer capture APIs remain in the automated context', async () => {
      const safe = await page.evaluate(() => ({ safe: globalThis.__browserInputFixture?.assertSafe(), mode: globalThis.__browserInputFixture?.pointerLockMode }));
      assert.deepEqual(safe, { safe: true, mode: 'virtual-pointer-lock' });
      diagnostics.inputFixture = safe;
    });
    await check('direct file launch shows welcome screen', async () => {
      await page.locator('#play-button').waitFor({ state: 'visible' });
      assert.match(await page.title(), /Mayhem Meadows/);
      assert.equal(await page.locator('#start-screen').isVisible(), true);
    });
    await check('desktop fits without horizontal overflow', async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    });
    await page.screenshot({ path: path.join(evidence, 'desktop-welcome.png'), fullPage: true });
    await page.locator('#play-button').click();
    await check('play focuses the game and dismisses welcome', async () => {
      await page.locator('#start-screen').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
    });
    let defaultFootYaw;
    await check('perspective third-person scene uses a live WebGL 2 renderer', async () => {
      const before = await waitForScene(page, 'foot');
      defaultFootYaw = before.cameraYaw;
      assert.equal(before.projection, 'perspective');
      assert.ok(before.cameraDistance > 2, 'Foot camera should sit behind the avatar.');
      assert.ok(Number.isFinite(before.cameraYaw), 'Camera yaw must be finite.');
      assert.equal(await page.locator('#renderer-error').isVisible(), false);
      assert.equal(await page.locator('#game-canvas').evaluate(canvas => canvas.getContext('webgl2') instanceof WebGL2RenderingContext), true);
      const after = await waitForFreshFrames(page);
      assert.ok(after.frames > before.frames, 'Simulation frames must advance.');
      assert.ok(after.renderCalls > 0, 'The scene must draw geometry.');
      assert.ok([after.cameraX, after.cameraY, after.cameraZ, after.targetX, after.targetY, after.targetZ].every(Number.isFinite), 'Camera and target positions must be finite.');
      assert.ok(after.cameraY > after.targetY, 'Third-person view should sit above its target.');
      diagnostics.foot = after;
    });
    await check('the attached-map road graph connects city, suburbs, airport and ridge districts with raised rotated colliders and real parking', async () => {
      // Observe real unattended settling before validating the parking bays.
      await page.waitForTimeout(600);
      const world = await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene, radius = globalThis.MayhemPhysics.PLAYER_RADIUS;
        const colliderBodies = game.vehiclePhysics.world.bodies.filter(body => body.kind === 'building');
        const collisionMatches = game.buildings.every((building, index) => {
          const body = colliderBodies[index], shape = body?.shapes[0];
          return body && shape && Math.abs(body.position.x * 20 - building.x - building.w / 2) < 0.01 &&
            Math.abs(body.position.z * 20 - building.y - building.h / 2) < 0.01 &&
            Math.abs(body.position.y + body.shapeOffsets[0].y + shape.halfExtents.y - (building.elevation || 0) - building.height) < 0.01 &&
            Math.abs(body.position.y + body.shapeOffsets[0].y - shape.halfExtents.y - (building.foundationBottom ?? building.elevation ?? 0)) < 0.01 &&
            Math.abs(shape.halfExtents.x * 40 - building.w) < 0.01 && Math.abs(shape.halfExtents.z * 40 - building.h) < 0.01 &&
            Math.abs(Math.abs(body.quaternion.y * Math.sin(-(building.angle || 0) / 2) + body.quaternion.w * Math.cos(-(building.angle || 0) / 2)) - 1) < 0.0001;
        });
        const renderMatches = game.buildings.every(building => {
          const frame = scene._buildingFrames.get(building.id);
          return frame && Math.abs(frame.center.x * 20 - building.x - building.w / 2) < 0.01 &&
            Math.abs(frame.center.z * 20 - building.y - building.h / 2) < 0.01 &&
            Math.abs(frame.baseElevation - (building.elevation || 0)) < 0.01 &&
            Math.abs(frame.width * 20 - building.w) < 0.01 && Math.abs(frame.depth * 20 - building.h) < 0.01 &&
            Math.abs(Math.atan2(Math.sin(frame.yaw + (building.angle || 0)), Math.cos(frame.yaw + (building.angle || 0)))) < 0.0001;
        });
        let bayMesh;
        scene.scene.traverse(object => { if (object.isMesh && object.material.color?.getHexString() === '9caca9') bayMesh = object; });
        const bays = game.world.parkingBays;
        const bayPositions = bayMesh?.geometry.getAttribute('position');
        // Paving is a merged, terrain-conforming grid. Every real bay corner
        // must occur at its source footprint and sampled local ground height.
        const parkingRendered = Boolean(bayPositions && bays.every(bay => globalThis.MayhemWorld.footprintCorners(bay).every(corner => {
          const height = game.world.terrain.surfaceHeight(corner.x, corner.y) + 0.028;
          for (let vertex = 0; vertex < bayPositions.count; vertex++) {
            if (Math.hypot(bayPositions.getX(vertex) * 20 - corner.x, bayPositions.getZ(vertex) * 20 - corner.y) < 0.01 &&
              Math.abs(bayPositions.getY(vertex) - height) < 0.01) return true;
          }
          return false;
        })));
        const parkedSpawns = game.world.vehicleSpawns.filter(spawn => !spawn.traffic);
        const parkedVehicles = parkedSpawns.map(spawn => {
          const bay = bays.find(bay => bay.id === spawn.parkingBayId);
          const car = game.cars.filter(car => !car.traffic && car.kind === spawn.kind && car.roadId === spawn.roadId)
            .sort((a, b) => Math.hypot(a.x - spawn.x, a.y - spawn.y) - Math.hypot(b.x - spawn.x, b.y - spawn.y))[0];
          const model = car && scene._vehicles.get(car.id);
          if (!bay || !car || !model) return { roadId: spawn.roadId, contained: false };
          const body = game.vehiclePhysics.get(car.id), half = body.shapes[0].halfExtents;
          const c = Math.cos(bay.angle || 0), s = Math.sin(bay.angle || 0);
          const dx = car.x - bay.x - bay.w / 2, dy = car.y - bay.y - bay.h / 2;
          const localX = dx * c + dy * s, localY = -dx * s + dy * c;
          const corners = [];
          for (const x of [-half.x, half.x]) for (const y of [-half.y, half.y]) for (const z of [-half.z, half.z]) {
            const offset = body.quaternion.vmult(new globalThis.CANNON.Vec3(x, y, z));
            corners.push({ x: (offset.x * c + offset.z * s) * 20, y: (-offset.x * s + offset.z * c) * 20 });
          }
          const extentX = Math.max(...corners.map(corner => Math.abs(corner.x)));
          const extentY = Math.max(...corners.map(corner => Math.abs(corner.y)));
          const sourceCentered = Math.hypot(spawn.x - bay.x - bay.w / 2, spawn.y - bay.y - bay.h / 2) < 0.01;
          const contained = Math.abs(localX) + extentX <= bay.w / 2 + 0.05 && Math.abs(localY) + extentY <= bay.h / 2 + 0.05;
          const renderedAligned = Math.hypot(model.group.position.x * 20 - car.x, model.group.position.z * 20 - car.y) < 0.1;
          return { id: car.id, roadId: spawn.roadId, sourceCentered, contained, renderedAligned, upright: car.upright,
            drift: Math.hypot(car.x - spawn.x, car.y - spawn.y), speed: car.speed, localX, localY, extentX, extentY, bayWidth: bay.w, bayDepth: bay.h };
        });
        const parkingAligned = parkedVehicles.every(car => car.sourceCentered && car.contained && car.renderedAligned && car.upright);
        const curvedRoads = game.roads.filter(road => {
          const first = game.network.pointOnRoad(road.id, road.length * 0.1), last = game.network.pointOnRoad(road.id, road.length * 0.9);
          return Math.abs(Math.atan2(Math.sin(first.angle - last.angle), Math.cos(first.angle - last.angle))) > 0.08;
        }).length;
        const density = id => { const lots = game.blocks.filter(block => block.district === id); return lots.reduce((sum, lot) => sum + lot.density, 0) / lots.length; };
        const connected = game.nodes.every(node => game.network.route(game.player, node).length > 0);
        return { size: game.world.size, roads: game.roads.length, nodes: game.nodes.length, curvedRoads, connected,
          blocks: game.blocks.length, buildings: game.buildings.length,
          districts: [...new Set(game.blocks.map(block => block.district))], areaDistricts: [...new Set(game.areas.map(area => area.district))], expectedDistricts: Object.keys(game.world.districts),
          footprints: [...new Set(game.buildings.map(building => `${building.w}x${building.h}`))],
          orientations: [...new Set(game.buildings.map(building => (building.angle || 0).toFixed(2)))],
          density: { market: density('market'), works: density('works'), willow: density('willow'), orchard: density('orchard') },
          heights: [...new Set(game.buildings.map(building => building.height))], collisionMatches, renderMatches,
          parking: { bays: bays.length, parkedSpawns: parkedSpawns.length, parkingRendered, parkingAligned, parkedVehicles },
          info: scene.worldInfo, playerClear: game._isFree(game.player.x, game.player.y, radius),
          starterClear: game._vehicleFree(game.cars[0]),
          starterDistance: Math.hypot(game.player.x - game.cars[0].x, game.player.y - game.cars[0].y) };
      });
      diagnostics.worldLayout = world;
      assert.ok(world.size > 5000 && world.roads > 40 && world.nodes > 30 && world.curvedRoads > 10);
      assert.equal(world.connected, true, 'Every real junction must be reachable from the starter road through the graph.');
      assert.ok(world.buildings >= 90 && world.footprints.length >= 4 && world.orientations.length > 10, 'Street frontage must use varied footprints and orientations.');
      assert.deepEqual(world.areaDistricts.sort(), world.expectedDistricts.sort(), 'Mapped district coverage includes open marsh as well as developed lots.');
      assert.ok(world.density.market > world.density.willow, 'Northside gardens must occupy more space around each home than Downtown lots.');
      assert.ok(world.heights.length >= 3);
      assert.ok(world.info.sidewalkWidth >= 1.5, 'Sidewalk geometry must be wider than the old narrow strip.');
      assert.equal(world.collisionMatches, true, 'Actual Cannon building bodies must follow the new varied footprints.');
      assert.equal(world.renderMatches, true, 'Rendered footprint frames must share every building center, size and rotation with the actual physics.');
      assert.equal(world.info.roads, world.roads); assert.equal(world.info.nodeCount, world.nodes);
      assert.equal(world.info.parkingBays, world.parking.bays); assert.equal(world.parking.bays, world.parking.parkedSpawns);
      assert.ok(world.parking.bays > 0 && world.parking.parkingRendered && world.parking.parkingAligned, 'Every parked spawn must sit in its actual rendered parking bay outside the traffic lanes.');
      assert.equal(world.playerClear, true); assert.equal(world.starterClear, true);
      assert.ok(world.starterDistance < 55, 'The starter car must remain within a useful entry distance.');
      diagnostics.worldLayout = world;
    });
    await check('player and resident meshes use the shared smaller character scale and a matching muzzle height', async () => {
      const characters = await page.evaluate(() => {
        const scene = globalThis.__browserCheckScene, physics = globalThis.MayhemPhysics;
        return { expected: physics.CHARACTER_SCALE, muzzleHeight: physics.MUZZLE_HEIGHT,
          playerScale: scene._player.group.scale.toArray(),
          residents: [...scene._residents.values()].map(model => model.group.scale.toArray()),
          cameraTarget: scene.cameraInfo.targetY, playerElevation: globalThis.__browserCheckGame.player.elevation };
      });
      assert.equal(characters.expected, 0.86);
      assert.ok(characters.playerScale.every(scale => Math.abs(scale - characters.expected) < 0.0001));
      assert.ok(characters.residents.length > 0 && characters.residents.every(axes => axes.every(scale => Math.abs(scale - characters.expected) < 0.0001)));
      assert.ok(Math.abs(characters.muzzleHeight - 1.15 * characters.expected) < 0.0001);
      assert.ok(characters.cameraTarget > characters.playerElevation, 'The camera must still frame the scaled avatar above its feet.');
      diagnostics.characters = characters;
    });
    await check('district HUD changes to the live district name as the player visits each area and restores the starter position', async () => {
      const fixture = await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, original = { x: game.player.x, y: game.player.y, angle: game.player.angle };
        const points = [];
        for (const district of Object.keys(globalThis.MayhemCore.DISTRICTS)) {
          const road = game.roads.find(candidate => candidate.district === district && game.districtAt(game.network.pointOnRoad(candidate.id, candidate.length / 2)).id === district);
          if (!road) throw new Error(`District ${district} must have a playable road position.`);
          const point = game.network.pointOnRoad(road.id, road.length / 2);
          const districtInfo = game.districtAt(point);
          points.push({ ...point, id: districtInfo.id, name: districtInfo.name, display: districtInfo.name.toUpperCase() });
        }
        game.cars = game.cars.filter(car => !car.traffic); game.police = [];
        return { original, points };
      });
      try {
        for (const point of fixture.points) {
          await page.evaluate(target => Object.assign(globalThis.__browserCheckGame.player, { ...globalThis.__browserCheckPose(target), verticalVelocity: 0, grounded: true }), point);
          await page.waitForFunction(display => document.getElementById('district-name').textContent === display, point.display);
          assert.equal(await page.locator('#district-name').textContent(), point.display);
          assert.equal(await page.locator('#game-canvas').getAttribute('data-district'), point.id);
        }
      } finally {
        await page.evaluate(original => Object.assign(globalThis.__browserCheckGame.player, { ...globalThis.__browserCheckPose(original), verticalVelocity: 0, grounded: true }), fixture.original);
        await page.keyboard.press('c'); await waitForFreshFrames(page);
      }
      diagnostics.districtVisits = fixture.points;
      await page.screenshot({ path: path.join(evidence, 'desktop-district-street.png'), fullPage: true });
    });
    await waitForMinimap(page);
    await page.screenshot({ path: path.join(evidence, 'desktop-third-person-foot.png'), fullPage: true });
    await check('click enters virtual test pointer capture without firing or aiming', async () => {
      await page.evaluate(() => { const game = globalThis.__browserCheckGame; game.cars = game.cars.filter(car => !car.traffic); game.police = []; });
      const before = await page.evaluate(() => ({ actionCooldown: globalThis.__browserCheckGame._actionCooldown, projectiles: globalThis.__browserCheckGame.projectiles.length }));
      await captureMouse(page);
      const after = await page.evaluate(() => ({ actionCooldown: globalThis.__browserCheckGame._actionCooldown, projectiles: globalThis.__browserCheckGame.projectiles.length }));
      assert.deepEqual(after, before, 'The capture click must never spend a shot or activate a toy.');
      assert.equal((await sceneState(page)).aiming, 'false');
      assert.equal(await page.locator('#aim-reticle').evaluate(element => element.classList.contains('aiming')), false);
      assert.equal(await page.locator('#mouse-hint').isVisible(), false);
    });
    await check('relative DOM pointer input looks right and up without holding a button; C recenters', async () => {
      const before = await sceneState(page);
      await lookCamera(page, 70, -20);
      const after = await sceneState(page);
      assert.ok(angleDifference(after.cameraYaw, before.cameraYaw) > 0.1, 'Moving the mouse right must look right.');
      assert.ok(after.cameraPitch > before.cameraPitch + 0.03, 'Moving the mouse up must look above the previous view.');
      assert.equal(after.cameraMode, 'foot');
      assert.ok(after.cameraDistance > 0.4, 'Camera boom must stay outside the avatar.');
      assert.equal(after.aiming, 'false', 'Free look must not require the aiming button.');
      await page.keyboard.press('c');
      await page.waitForFunction(expectedYaw => {
        const yaw = Number(document.getElementById('game-canvas').dataset.cameraYaw);
        return Math.abs(Math.atan2(Math.sin(yaw - expectedYaw), Math.cos(yaw - expectedYaw))) < 0.08;
      }, defaultFootYaw, { timeout: 2500 });
      const reset = await sceneState(page);
      assert.ok(Math.abs(angleDifference(reset.cameraYaw, defaultFootYaw)) < 0.08, 'C should restore the view behind the initial player heading.');
      assert.ok(Math.abs(reset.cameraPitch - before.cameraPitch) < 0.08, 'C should also restore the normal exploration pitch.');
    });
    await check('right mouse aims over the shoulder with a central reticle, narrower FOV and slower look', async () => {
      await page.waitForTimeout(450);
      const normal = await sceneState(page);
      await lookCamera(page, 70);
      const freelyLooked = await sceneState(page);
      const freeDelta = angleDifference(freelyLooked.cameraYaw, normal.cameraYaw);
      await page.keyboard.press('c');
      await page.waitForTimeout(500);
      const before = await sceneState(page);
      await page.mouse.down({ button: 'right' });
      await page.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'true');
      await page.waitForTimeout(350);
      const shoulder = await sceneState(page);
      assert.equal(await page.locator('#aim-reticle').isVisible(), true);
      const centered = await page.locator('#aim-reticle').evaluate(reticle => {
        const mark = reticle.getBoundingClientRect(), canvas = document.getElementById('game-canvas').getBoundingClientRect();
        return Math.abs(mark.x + mark.width / 2 - canvas.x - canvas.width / 2) < 3 && Math.abs(mark.y + mark.height / 2 - canvas.y - canvas.height / 2) < 3;
      });
      assert.equal(centered, true, 'Aim reticle must sit at the centre of the camera view.');
      assert.ok(shoulder.cameraFov < before.cameraFov - 5, 'Aiming must bring the view closer through a narrower field of view.');
      await lookCamera(page, 70);
      const aimed = await sceneState(page);
      const aimDelta = angleDifference(aimed.cameraYaw, shoulder.cameraYaw);
      assert.ok(aimDelta > 0.02 && aimDelta < freeDelta * 0.8, `Aiming sensitivity should be lower; free ${freeDelta.toFixed(3)}, aimed ${aimDelta.toFixed(3)}.`);
      diagnostics.aim = aimed;
      await page.screenshot({ path: path.join(evidence, 'desktop-shoulder-aim.png'), fullPage: true });
      await page.mouse.up({ button: 'right' });
      await page.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'false');
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#aim-reticle').evaluate(element => element.classList.contains('aiming')), false);
      assert.ok((await sceneState(page)).cameraFov > shoulder.cameraFov + 5, 'Releasing aim must restore the exploration view.');
      await page.keyboard.press('c');
    });
    await check('Space jumps on foot, moves the rendered avatar and lands without firing a toy or repeating while held', async () => {
      // Keep this control lesson deterministic: a passing traffic car must not
      // knock the jumper down and leave the following aim check in a ragdoll.
      await page.evaluate(() => { const game = globalThis.__browserCheckGame; game.cars = game.cars.filter(car => !car.traffic); game.police = []; });
      const before = await page.evaluate(() => ({ actionCooldown: globalThis.__browserCheckGame._actionCooldown, projectiles: globalThis.__browserCheckGame.projectiles.length }));
      await page.keyboard.down('Space');
      try {
        await page.waitForFunction(() => { const player = globalThis.__browserCheckGame.player; return player.elevation - globalThis.__browserCheckGround(player) > 1; }, null, { timeout: 1500 });
        const airborne = await page.evaluate(() => {
          const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
          return { elevation: game.player.elevation, groundHeight: globalThis.__browserCheckGround(game.player), renderedHeight: scene._player.group.position.y, grounded: game.player.grounded };
        });
        assert.equal(airborne.grounded, false);
        assert.ok(airborne.renderedHeight - airborne.groundHeight > 1, 'The visible avatar must rise above its local ground with the jumping player.');
        diagnostics.jump = airborne;
        await page.screenshot({ path: path.join(evidence, 'desktop-jump.png'), fullPage: true });
        await page.waitForFunction(() => { const player = globalThis.__browserCheckGame.player; return player.grounded && Math.abs(player.elevation - globalThis.__browserCheckGround(player)) < 0.05; }, null, { timeout: 2000 });
        await page.waitForTimeout(700);
        assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.player.grounded), true, 'Holding Space must not keep jumping after landing.');
      } finally { await page.keyboard.up('Space'); }
      await waitForFreshFrames(page);
      assert.deepEqual(await page.evaluate(() => ({ actionCooldown: globalThis.__browserCheckGame._actionCooldown, projectiles: globalThis.__browserCheckGame.projectiles.length })), before);
    });
    await check('Escape releases virtual capture, clears aiming and pauses; resuming requires a fresh click', async () => {
      await page.mouse.down({ button: 'right' });
      await page.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'true');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.pointerLockElement);
      await page.locator('#pause-screen').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'false');
      assert.equal((await sceneState(page)).aiming, 'false');
      assert.equal(await page.locator('#aim-reticle').isVisible(), false);
      await page.mouse.up({ button: 'right' });
      await page.locator('#resume-button').click();
      await page.locator('#pause-screen').waitFor({ state: 'hidden' });
      assert.equal(await page.evaluate(() => document.pointerLockElement), null);
      await page.locator('#mouse-hint').waitFor({ state: 'visible' });
      await captureMouse(page);
      assert.equal((await sceneState(page)).aiming, 'false', 'A held aiming button must not survive a menu.');
    });
    await check('help sensitivity and invert-Y settings change free look and survive reload', async () => {
      await unlockToUI(page);
      await page.locator('#help-toggle').click();
      await page.locator('#help-screen').waitFor({ state: 'visible' });
      await page.locator('#camera-sensitivity').fill('0.5');
      await page.locator('#camera-invert-y').check();
      assert.match(await page.locator('#camera-sensitivity-value').textContent(), /0\.50/);
      await page.locator('#close-help').click();
      await captureMouse(page);
      await page.keyboard.press('c');
      await page.waitForTimeout(250);
      const lowBefore = await sceneState(page);
      await lookCamera(page, 60, -20);
      const lowAfter = await sceneState(page);
      const lowDelta = angleDifference(lowAfter.cameraYaw, lowBefore.cameraYaw);
      assert.ok(lowAfter.cameraPitch < lowBefore.cameraPitch - 0.01, 'Invert-Y should make upward mouse movement look down.');
      await unlockToUI(page);
      await page.locator('#help-toggle').click();
      await page.locator('#help-screen').waitFor({ state: 'visible' });
      await page.locator('#camera-sensitivity').fill('1.5');
      await page.locator('#camera-invert-y').uncheck();
      await page.locator('#close-help').click();
      await captureMouse(page);
      await page.keyboard.press('c');
      await page.waitForTimeout(250);
      const highBefore = await sceneState(page);
      await lookCamera(page, 60, -20);
      const highAfter = await sceneState(page);
      const highDelta = angleDifference(highAfter.cameraYaw, highBefore.cameraYaw);
      assert.ok(highDelta > lowDelta * 2.1, `Sensitivity should alter the camera response; low ${lowDelta.toFixed(3)}, high ${highDelta.toFixed(3)}.`);
      assert.ok(highAfter.cameraPitch > highBefore.cameraPitch + 0.01);
      await page.reload();
      assert.equal(await page.locator('#camera-sensitivity').inputValue(), '1.5');
      assert.equal(await page.locator('#camera-invert-y').isChecked(), false);
      await page.locator('#play-button').click();
      await waitForScene(page, 'foot');
      // Restore defaults so later geometry checks use the standard view.
      await page.locator('#help-toggle').click();
      await page.locator('#help-screen').waitFor({ state: 'visible' });
      await page.locator('#camera-sensitivity').fill('1');
      await page.locator('#close-help').click();
    });
    await check('W walks in the direction of an orbited camera', async () => {
      await lookCamera(page, 60);
      const before = await sceneState(page);
      const forward = { x: before.targetX - before.cameraX, y: before.targetZ - before.cameraZ };
      assert.ok(Math.hypot(forward.x, forward.y) > 0.1, 'Camera needs a horizontal view direction.');
      await page.keyboard.down('w');
      await page.waitForTimeout(180);
      await page.keyboard.up('w');
      await page.waitForTimeout(120);
      const after = await sceneState(page);
      const move = { x: after.worldX - before.worldX, y: after.worldY - before.worldY };
      assert.ok(Math.hypot(move.x, move.y) > 2, 'W should move the avatar.');
      const alignment = (move.x * forward.x + move.y * forward.y) / (Math.hypot(move.x, move.y) * Math.hypot(forward.x, forward.y));
      assert.ok(alignment > 0.9, `Movement should follow the view direction; alignment was ${alignment.toFixed(3)}.`);
      await page.keyboard.press('c');
      await unlockToUI(page);
    });
    await check('E borrows the nearby yellow car', async () => {
      await page.keyboard.press('e');
      const state = await waitForScene(page, 'drive');
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.player.vehicleId === globalThis.__browserCheckGame.cars[0].id), true);
      await assertRideName(page);
      assert.ok(state.cameraDistance > 3, 'Driving camera should pull back to show the whole ride.');
    });
    await check('exiting a ride switches back to the foot camera', async () => {
      await page.waitForTimeout(350);
      await page.keyboard.press('e');
      await waitForScene(page, 'foot');
      assert.equal(await page.locator('#ride-name').textContent(), 'Fresh sneakers');
      await page.waitForTimeout(350);
      await page.keyboard.press('e');
      await waitForScene(page, 'drive');
      await assertRideName(page);
    });
    await check('driving supports free look while aim and fire remain on-foot controls', async () => {
      await captureMouse(page);
      const before = await sceneState(page);
      const ammo = await page.evaluate(() => globalThis.__browserCheckGame.inventory.ammo.cannon);
      await page.mouse.down({ button: 'right' });
      await lookCamera(page, 80);
      const looked = await sceneState(page);
      assert.ok(angleDifference(looked.cameraYaw, before.cameraYaw) > 0.15, 'The driving camera must respond to captured mouse movement.');
      assert.equal(looked.aiming, 'false', 'Holding aim in a vehicle must not enter the shoulder view.');
      assert.equal(await page.locator('#aim-reticle').isVisible(), false);
      await fireToy(page);
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.inventory.ammo.cannon), ammo);
      await page.waitForTimeout(350);
      assert.ok(Math.abs(angleDifference((await sceneState(page)).cameraYaw, before.cameraYaw)) > 0.1, 'Automatic follow must give the player time to look around.');
      await page.mouse.up({ button: 'right' });
      await page.keyboard.press('c');
      await page.waitForTimeout(350);
      const carHeading = await page.evaluate(() => globalThis.__browserCheckGame.current.angle);
      assert.ok(Math.abs(angleDifference((await sceneState(page)).cameraYaw, carHeading)) < 0.1, 'C must recenter behind the car.');
      await unlockToUI(page);
    });
    await check('delivery contract changes the objective', async () => {
      const before = await page.locator('#objective-title').textContent();
      await page.locator('[data-mission="delivery"]').click();
      await page.waitForFunction(previous => document.getElementById('objective-title').textContent !== previous, before, { timeout: 2000 });
      assert.match(await page.locator('#mission-time').textContent(), /s bonus|OVERTIME/);
    });
    await check('W drives the car and changes target distance', async () => {
      const before = await page.locator('#mission-progress').textContent();
      await page.keyboard.down('w');
      await page.waitForTimeout(900);
      await page.keyboard.up('w');
      await page.waitForTimeout(160);
      assert.notEqual(await page.locator('#mission-progress').textContent(), before);
      await assertRideName(page);
    });
    await check('Space still applies the driving handbrake', async () => {
      await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, car = game.current;
        const lane = globalThis.__browserCheckLane();
        Object.assign(car, { ...lane.point(), angle: lane.angle });
        game.vehiclePhysics.reset(car);
        Object.assign(car, { speed: 100, vx: lane.ux * 100, vy: lane.uy * 100 });
      });
      const before = await page.evaluate(() => Math.abs(globalThis.__browserCheckGame.current.speed));
      await page.keyboard.down('Space');
      await page.waitForTimeout(250);
      await page.keyboard.up('Space');
      const after = await page.evaluate(() => Math.abs(globalThis.__browserCheckGame.current.speed));
      assert.ok(after < before * 0.5, `The handbrake should slow the car quickly; ${before.toFixed(1)} to ${after.toFixed(1)}.`);
    });
    await check('driving minimap renders the town and updates after resize', async () => {
      await waitForMinimap(page);
      await page.setViewportSize({ width: 1280, height: 800 });
      await waitForFreshFrames(page);
      await waitForMinimap(page);
      await page.setViewportSize({ width: 1365, height: 900 });
      await waitForFreshFrames(page);
      await waitForMinimap(page);
      const state = await sceneState(page);
      assert.equal(state.cameraMode, 'drive');
      diagnostics.drive = state;
    });
    await check('fullscreen preserves the HUD and contracts, and exits back to play', async () => {
      await page.locator('#fullscreen-toggle').click();
      await page.waitForFunction(() => document.fullscreenElement?.classList.contains('app'), null, { timeout: 3000 });
      assert.equal(await page.locator('[data-mission="dash"]').isVisible(), true);
      assert.equal(await page.locator('#cash').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      diagnostics.fullscreen = await waitForFreshFrames(page);
      await waitForMinimap(page);
      await page.screenshot({ path: path.join(evidence, 'desktop-fullscreen-driving.png'), fullPage: true });
      await page.locator('#fullscreen-toggle').click();
      await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 });
      assert.equal(await page.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
      await waitForFreshFrames(page);
      await waitForMinimap(page);
    });
    await check('P pauses the mission clock and resume continues it', async () => {
      await page.keyboard.press('p');
      await page.locator('#pause-screen').waitFor({ state: 'visible' });
      await page.waitForTimeout(150);
      const pausedTime = await page.locator('#mission-time').textContent();
      await page.waitForTimeout(1150);
      assert.equal(await page.locator('#mission-time').textContent(), pausedTime);
      await page.locator('#resume-button').click();
      await page.locator('#pause-screen').waitFor({ state: 'hidden' });
      await page.waitForTimeout(1250);
      assert.notEqual(await page.locator('#mission-time').textContent(), pausedTime);
    });
    await check('help opens and Escape restores play', async () => {
      await page.locator('#help-toggle').click();
      await page.locator('#help-screen').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.locator('#help-screen').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#pause-screen').isVisible(), false);
    });
    await waitForMinimap(page);
    await page.screenshot({ path: path.join(evidence, 'desktop-driving.png'), fullPage: true });
    await check('contract can be abandoned and another accepted', async () => {
      assert.equal(await page.locator('#abandon-button').isEnabled(), true);
      await page.locator('#abandon-button').click();
      await page.waitForFunction(() => !document.querySelector('[data-mission="dash"]').disabled, null, { timeout: 2000 });
      await page.locator('[data-mission="dash"]').click();
      await page.waitForFunction(() => document.querySelector('[data-mission="dash"]').disabled, null, { timeout: 2000 });
      assert.match(await page.locator('#mission-time').textContent(), /s bonus|OVERTIME/);
    });
    await check('sound and motion toggles keep the game focused', async () => {
      for (const selector of ['#sound-toggle', '#motion-toggle']) {
        await page.locator(selector).click();
        assert.equal(await page.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
        await page.locator(selector).click();
        assert.equal(await page.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
      }
    });
    await check('sound and motion settings survive reload', async () => {
      const initialSound = await page.locator('#sound-toggle').textContent();
      const initialMotion = await page.locator('#motion-toggle').textContent();
      await page.locator('#sound-toggle').click();
      await page.locator('#motion-toggle').click();
      const sound = await page.locator('#sound-toggle').textContent();
      const motion = await page.locator('#motion-toggle').textContent();
      assert.notEqual(sound, initialSound);
      assert.notEqual(motion, initialMotion);
      await page.reload();
      assert.equal(await page.locator('#sound-toggle').textContent(), sound);
      assert.equal(await page.locator('#motion-toggle').textContent(), motion);
    });
    await check('saved cash survives a normal reload', async () => {
      // Seed only the documented local save, never the game instance or simulation.
      const fresh = await context.newPage();
      fresh.on('pageerror', error => errors.push(error.message));
      await fresh.addInitScript(key => {
        if (sessionStorage.getItem('browser-check.cash-seeded')) return;
        const saved = JSON.parse(localStorage.getItem(key));
        if (!saved?.progress) throw new Error('No progress save was written.');
        saved.progress.money = 1234;
        localStorage.setItem(key, JSON.stringify(saved));
        sessionStorage.setItem('browser-check.cash-seeded', 'yes');
      }, saveKey);
      await fresh.goto(url);
      await fresh.waitForFunction(() => document.getElementById('cash').textContent === '$1,234', null, { timeout: 2000 });
      await fresh.reload();
      assert.equal(await fresh.locator('#cash').textContent(), '$1,234');
      await fresh.close();
    });
    await check('short desktop viewport scrolls while the WebGL canvas keeps valid dimensions', async () => {
      await page.setViewportSize({ width: 1365, height: 450 });
      await page.reload();
      await page.locator('#play-button').click();
      await page.locator('#start-screen').waitFor({ state: 'hidden' });
      await waitForScene(page, 'foot');
      await waitForMinimap(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), 'Short windows should let the page scroll.');
      assert.equal(await page.locator('#game-canvas').evaluate(canvas => {
        const viewport = canvas.getContext('webgl2').getParameter(WebGL2RenderingContext.VIEWPORT);
        return canvas.clientWidth > 300 && canvas.clientHeight > 300 && viewport[2] === canvas.width && viewport[3] === canvas.height;
      }), true);
      await page.screenshot({ path: path.join(evidence, 'short-desktop-play.png'), fullPage: true });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await check('390px mobile layout fits and Play stays clickable', async () => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.locator('#play-button').click();
      await page.locator('#start-screen').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('#game-canvas').isVisible(), true);
    });
    await page.screenshot({ path: path.join(evidence, 'mobile-play.png'), fullPage: true });
    await check('camera settings remain reachable in the narrow help dialog', async () => {
      await page.locator('#help-toggle').click();
      await page.locator('#help-screen').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.locator('#camera-sensitivity').scrollIntoViewIfNeeded();
      await page.locator('#camera-sensitivity').fill('0.75');
      await page.locator('#camera-invert-y').scrollIntoViewIfNeeded();
      await page.locator('#camera-invert-y').check();
      assert.equal(await page.locator('#camera-sensitivity').inputValue(), '0.75');
      assert.equal(await page.locator('#camera-invert-y').isChecked(), true);
      await page.screenshot({ path: path.join(evidence, 'mobile-camera-settings.png'), fullPage: true });
      await page.locator('#close-help').click();
      await page.locator('#help-screen').waitFor({ state: 'hidden' });
    });
    await check('blocked local storage still permits Play and car entry', async () => {
      const blockedContext = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
      try {
        await installEngineInspection(blockedContext);
        await blockedContext.route('**/*', route => {
          if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
          externalRequests.push(route.request().url());
          return route.abort();
        });
        await blockedContext.addInitScript(() => {
          for (const method of ['getItem', 'setItem']) {
            Object.defineProperty(Storage.prototype, method, {
              configurable: true,
              value() { throw new DOMException('Storage disabled by this browser check.', 'SecurityError'); },
            });
          }
        });
        const blockedPage = await blockedContext.newPage();
        blockedPage.on('pageerror', error => errors.push(error.message));
        blockedPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await blockedPage.goto(url);
        assert.deepEqual(await blockedPage.evaluate(() => {
          return ['getItem', 'setItem'].map(method => {
            try { localStorage[method]('browser-check', 'disabled'); return 'unexpected success'; }
            catch (error) { return error.name; }
          });
        }), ['SecurityError', 'SecurityError']);
        await blockedPage.locator('#play-button').click();
        await blockedPage.locator('#start-screen').waitFor({ state: 'hidden' });
        await waitForScene(blockedPage, 'foot');
        assert.match(await blockedPage.locator('#toast').textContent(), /Saving is unavailable/);
        await blockedPage.keyboard.press('e');
        await waitForScene(blockedPage, 'drive');
        await assertRideName(blockedPage);
        await blockedPage.locator('#sound-toggle').click();
        await blockedPage.locator('#motion-toggle').click();
        assert.equal(await blockedPage.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
        await blockedPage.screenshot({ path: path.join(evidence, 'storage-blocked-play.png'), fullPage: true });
      } finally { await closeTestContext(blockedContext); }
    });
    await check('missing WebGL 2 shows a friendly renderer message without uncaught errors', async () => {
      const unsupportedContext = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
      const unsupportedErrors = [];
      try {
        await unsupportedContext.route('**/*', route => {
          if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
          externalRequests.push(route.request().url());
          return route.abort();
        });
        await unsupportedContext.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
            if (kind === 'webgl2') return null;
            return original.call(this, kind, ...args);
          };
        });
        const unsupportedPage = await unsupportedContext.newPage();
        unsupportedPage.on('pageerror', error => unsupportedErrors.push(error.message));
        unsupportedPage.on('console', message => {
          if (message.type() === 'error' && !/THREE\.WebGLRenderer: (Error creating WebGL context|A WebGL context could not be created)/.test(message.text())) unsupportedErrors.push(message.text());
        });
        await unsupportedPage.goto(url);
        await unsupportedPage.locator('#renderer-error').waitFor({ state: 'visible' });
        assert.match(await unsupportedPage.locator('#renderer-error').textContent(), /WebGL 2/);
        assert.equal(await unsupportedPage.locator('#reload-button').isVisible(), true);
        assert.deepEqual(unsupportedErrors, []);
        await unsupportedPage.screenshot({ path: path.join(evidence, 'webgl-unavailable.png'), fullPage: true });
      } finally { await closeTestContext(unsupportedContext); }
    });
    await check('the camera stays outside building walls during a full near-wall orbit', async () => {
      const wallContext = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
      try {
        await wallContext.route('**/*', route => {
          if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
          externalRequests.push(route.request().url());
          return route.abort();
        });
        const wallPage = await wallContext.newPage();
        await installEngineInspection(wallContext);
        wallPage.on('pageerror', error => errors.push(error.message));
        wallPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await wallPage.goto(url);
        await wallPage.locator('#play-button').click();
        await waitForScene(wallPage, 'foot');
        const wall = await wallPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, radius = globalThis.MayhemPhysics.PLAYER_RADIUS;
          game.cars = []; game.peds = []; game.police = []; game.physics.clearAll();
          const wall = globalThis.__browserCheckWall(), point = wall.point(radius + 35);
          if (!game._isFree(point.x, point.y, radius)) throw new Error('The generated town needs a clear rotated frontage for walking.');
          Object.assign(game.player, { ...point, verticalVelocity: 0, grounded: true, vehicleId: null, angle: wall.angle });
          return { ...wall.building, radius, ux: wall.ux, uy: wall.uy, center: wall.center, angle: wall.angle };
        });
        await captureMouse(wallPage);
        await wallPage.keyboard.press('c');
        await wallPage.waitForFunction(expected => Math.abs(Math.atan2(Math.sin(globalThis.__browserCheckScene.viewYaw - expected), Math.cos(globalThis.__browserCheckScene.viewYaw - expected))) < 0.05, wall.angle);
        const renderedWall = await wallPage.evaluate(fixture => {
          const scene = globalThis.__browserCheckScene, T = scene.T, player = globalThis.__browserCheckGame.player;
          const ray = new T.Raycaster(new T.Vector3(player.x / 20, player.elevation + 1.2, player.y / 20), new T.Vector3(fixture.ux, 0, fixture.uy));
          const meshes = [];
          scene.scene.traverse(object => {
            if (!object.isMesh) return;
            for (let ancestor = object; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return;
            meshes.push(object);
          });
          const hit = ray.intersectObjects(meshes, false)[0];
          return { distance: hit?.distance, expected: (fixture.radius + 35) / 20, angle: fixture.angle };
        }, wall);
        assert.ok(Math.abs(renderedWall.distance - renderedWall.expected) < 0.3, 'Visible rotated wall must lie at the same face as its physical collider.');
        diagnostics.rotatedWallAlignment = renderedWall;
        await wallPage.keyboard.down('w');
        await wallPage.waitForTimeout(350);
        await wallPage.keyboard.up('w');
        const nearWall = await sceneState(wallPage);
        const wallGap = -((nearWall.worldX - wall.center.x) * wall.ux + (nearWall.worldY - wall.center.y) * wall.uy) - wall.w / 2;
        assert.ok(wallGap >= wall.radius - 0.2 && wallGap < wall.radius + 8, 'The avatar should approach its rotated building wall without entering it.');
        for (let step = 0; step < 16; step++) {
          await lookCamera(wallPage, 100);
          const state = await sceneState(wallPage);
          assert.ok(state.cameraDistance > 0.4 && state.cameraDistance < 12, 'Camera boom length must remain usable.');
          assert.ok([state.cameraX, state.cameraY, state.cameraZ].every(Number.isFinite), 'Camera coordinates must stay finite.');
          const insideBuilding = await wallPage.evaluate(view => globalThis.__browserCheckGame.buildings.some(b => {
            const dx = view.cameraX * 20 - b.x - b.w / 2, dy = view.cameraZ * 20 - b.y - b.h / 2;
            const c = Math.cos(b.angle || 0), s = Math.sin(b.angle || 0);
            return Math.abs(dx * c + dy * s) < b.w / 2 - 0.1 && Math.abs(-dx * s + dy * c) < b.h / 2 - 0.1 && view.cameraY > (b.elevation || 0) && view.cameraY < (b.elevation || 0) + b.height;
          }), state);
          assert.equal(insideBuilding, false, `Camera entered a live building footprint on orbit step ${step}.`);
        }
        await wallPage.screenshot({ path: path.join(evidence, 'desktop-near-wall-orbit.png'), fullPage: true });
      } finally { await closeTestContext(wallContext); }
    });
    const networkContext = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
    try {
      await installEngineInspection(networkContext);
      await networkContext.route('**/*', route => {
        if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
        externalRequests.push(route.request().url()); return route.abort();
      });
      const networkPage = await networkContext.newPage();
      networkPage.on('pageerror', error => errors.push(error.message));
      networkPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await networkPage.goto(url);
      await networkPage.locator('#play-button').click();
      await waitForScene(networkPage, 'foot');
      await check('traffic advances along curved graph routes with finite collision-free poses', async () => {
        const before = await networkPage.evaluate(() => globalThis.__browserCheckGame.cars.filter(car => car.traffic).map(car => ({ id: car.id, x: car.x, y: car.y })));
        assert.ok(before.length >= 4);
        await networkPage.waitForTimeout(2200);
        const after = await networkPage.evaluate(() => {
          const game = globalThis.__browserCheckGame;
          return game.cars.filter(car => car.traffic).map(car => ({ id: car.id, x: car.x, y: car.y, speed: car.speed, free: game._vehicleFree(car),
            roadDistance: game.network.project(car).distance, width: game.network.project(car).width, routePoints: car.route?.length || 0 }));
        });
        assert.ok(after.every(car => [car.x, car.y, car.speed, car.roadDistance].every(Number.isFinite) && car.free && car.roadDistance < car.width / 2 + 20));
        assert.ok(after.filter(car => { const earlier = before.find(entry => entry.id === car.id); return earlier && Math.hypot(car.x - earlier.x, car.y - earlier.y) > 15; }).length >= before.length / 2);
        assert.ok(after.some(car => car.routePoints > 4), 'Traffic must use sampled bend routes rather than jumping from junction to junction.');
        diagnostics.graphTraffic = after;
      });
      await check('real keyboard steering follows bends into Northside and returns to town with district HUD, minimap and raised graph recovery intact', async () => {
        const fixture = await networkPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0];
          game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0;
          const destination = game.world.missionAnchors.suburbs.find(point => game.districtAt(point).id === 'willow');
          const route = game.network.route(car, destination, 0), forward = route.find(point => Math.hypot(point.x - car.x, point.y - car.y) > 55);
          car.angle = Math.atan2(forward.y - car.y, forward.x - car.x); game.vehiclePhysics.reset(car);
          return { origin: { x: car.x, y: car.y }, originDistrict: game.districtAt(car).id, destination, destinationName: game.districtAt(destination).name.toUpperCase() };
        });
        assert.ok(fixture.destination);
        await captureMouse(networkPage);
        await networkPage.keyboard.press('e');
        await waitForScene(networkPage, 'drive');
        diagnostics.suburbanJourney = { outbound: {}, inbound: {} };
        await driveNetworkRoute(networkPage, fixture.destination, diagnostics.suburbanJourney.outbound);
        await networkPage.waitForFunction(() => document.getElementById('game-canvas').dataset.district === 'willow');
        assert.equal(await networkPage.locator('#district-name').textContent(), fixture.destinationName);
        await waitForMinimap(networkPage);
        const farView = await sceneState(networkPage);
        assert.ok(Math.hypot(farView.worldX - fixture.origin.x, farView.worldY - fixture.origin.y) > 1500, 'The vehicle must physically reach Northside beyond the initial Downtown neighborhood.');
        assert.ok(diagnostics.suburbanJourney.outbound.headingChange > 0.3 && diagnostics.suburbanJourney.outbound.steeringChanges > 4, 'The journey must include real steering through bends.');
        await networkPage.keyboard.press('r');
        await waitForFreshFrames(networkPage);
        const recovery = await networkPage.evaluate(() => { const game = globalThis.__browserCheckGame, car = game.current, road = game.network.project(car);
          return { roadId: road.roadId, distance: road.distance, roadAngle: road.angle, x: car.x, y: car.y,
            free: game._vehicleFree(car), angle: car.angle, upright: car.upright, district: game.districtAt(car).id };
        });
        assert.ok(recovery.free && recovery.upright && recovery.distance < 1 && recovery.district === 'willow', 'R must recover onto an actual suburban road tangent.');
        assert.ok(Math.min(Math.abs(angleDifference(recovery.angle, recovery.roadAngle)), Math.abs(angleDifference(recovery.angle, recovery.roadAngle + Math.PI))) < 0.2, 'Recovery heading must follow the actual road tangent.');
        diagnostics.suburbanJourney.recovery = { x: recovery.x, y: recovery.y, roadId: recovery.roadId, distance: recovery.distance, angle: recovery.angle };
        await unlockToUI(networkPage);
        await networkPage.locator('[data-mission="delivery"]').click();
        const navigation = await networkPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, target = game.mission.targets[game.mission.targetIndex], car = game.current;
          return { target, meters: Math.round(Math.hypot(target.x - car.x, target.y - car.y) / 20) };
        });
        assert.ok(navigation.meters > 60, 'Suburban navigation must point to an objective far beyond the immediate street.');
        await networkPage.waitForFunction(meters => document.getElementById('target-distance').textContent === meters + 'm', navigation.meters);
        assert.equal(await networkPage.locator('#target-compass').isVisible(), true);
        assert.ok((await networkPage.locator('#mission-progress').textContent()).includes(navigation.meters + 'm'));
        await waitForMinimap(networkPage);
        const marker = await networkPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, canvas = document.getElementById('minimap-canvas');
          const x = Math.round(game.current.x / game.world.size * canvas.width), y = Math.round(game.current.y / game.world.size * canvas.width);
          const pixels = canvas.getContext('2d').getImageData(x - 2, y - 2, 5, 5).data;
          let white = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 235 && pixels[i + 1] > 225 && pixels[i + 2] > 190) white++;
          return { x, y, white, width: canvas.width, height: canvas.height };
        });
        assert.ok(marker.white > 3, 'The distant player marker must be drawn at the correct expanded-world minimap coordinates.');
        diagnostics.suburbanJourney.navigation = { ...navigation, marker };
        await captureMouse(networkPage);
        await networkPage.keyboard.press('c'); await networkPage.waitForTimeout(300);
        await networkPage.waitForFunction(() => Number(getComputedStyle(document.getElementById('toast')).opacity) === 0, null, { timeout: 6000 });
        await networkPage.screenshot({ path: path.join(evidence, 'desktop-suburban-street.png'), fullPage: true });
        await unlockToUI(networkPage); await networkPage.locator('#abandon-button').click(); await captureMouse(networkPage);
        await driveNetworkRoute(networkPage, fixture.origin, diagnostics.suburbanJourney.inbound);
        assert.ok(diagnostics.suburbanJourney.outbound.maxRoadDistance < 90 && diagnostics.suburbanJourney.inbound.maxRoadDistance < 90, 'Both real journeys must stay near the sampled road corridors.');
        assert.equal((await sceneState(networkPage)).district, fixture.originDistrict);
        await networkPage.keyboard.press('r'); await waitForFreshFrames(networkPage);
        await networkPage.keyboard.press('c'); await networkPage.waitForTimeout(300);
        await networkPage.screenshot({ path: path.join(evidence, 'desktop-curved-town-street.png'), fullPage: true });
        await captureNetworkOverview(networkPage);
      });
    } finally { await closeTestContext(networkContext); }
    await check('imported terrain uses the same real mesh and Cannon heightfield, with land and coastline on the minimap', async () => withTerrainPage(browser, externalRequests, checkSharedTerrain));
    await check('walking, jumping, ragdoll recovery and camera orbit follow a real elevated hill surface', async () => withTerrainPage(browser, externalRequests, checkHillWalking));
    await check('actual keyboard driving climbs a graded hill with supported rigid-body contact', async () => withTerrainPage(browser, externalRequests, checkHillDriving));
    await check('actual keyboard driving crosses the city-to-airport bridge on physical decks above water', async () => withTerrainPage(browser, externalRequests, checkBridgeDriving));
    await check('a raised garage allows real car entry, collection access and ground-relative exit', async () => withTerrainPage(browser, externalRequests, checkElevatedGarage));
    const physicsContext = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
    try {
      await physicsContext.route('**/*', route => {
        if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
        externalRequests.push(route.request().url());
        return route.abort();
      });
      await installEngineInspection(physicsContext);
      const physicsPage = await physicsContext.newPage();
      physicsPage.on('pageerror', error => errors.push(error.message));
      physicsPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await physicsPage.goto(url);
      await physicsPage.locator('#play-button').click();
      await waitForScene(physicsPage, 'foot');

      await check('F creates a rendered fifteen-joint player ragdoll that falls under gravity', async () => {
        await physicsPage.keyboard.press('f');
        await physicsPage.waitForFunction(() => {
          const data = document.getElementById('game-canvas').dataset;
          return data.playerRagdoll === 'fall' && Number(data.renderedRagdolls) > 0;
        }, null, { timeout: 2000 });
        const early = await bodyState(physicsPage);
        assertFiniteBody(early);
        await physicsPage.waitForFunction(() => globalThis.__browserCheckGame.physics.get('player')?.age >= 1.7, null, { timeout: 3000 });
        const fallen = await bodyState(physicsPage);
        assertFiniteBody(fallen);
        assert.notDeepEqual(fallen.joints, early.joints, 'Joint positions must evolve through physical motion.');
        assert.notDeepEqual(fallen.matrices, early.matrices, 'Rendered segments must follow the moving physical joints.');
        assert.ok(fallen.joints.head.y - fallen.groundHeight < 1.25, 'Gravity should bring the head below standing height above the local ground.');
        assert.equal((await sceneState(physicsPage)).cameraMode, 'foot');
        diagnostics.playerRagdoll = fallen;
        await physicsPage.screenshot({ path: path.join(evidence, 'desktop-player-ragdoll.png'), fullPage: true });
      });

      await check('pausing freezes every ragdoll joint and its recovery clock', async () => {
        await physicsPage.keyboard.press('p');
        await physicsPage.locator('#pause-screen').waitFor({ state: 'visible' });
        const before = await bodyState(physicsPage);
        assertFiniteBody(before);
        await physicsPage.waitForTimeout(550);
        const after = await bodyState(physicsPage);
        assert.equal(after.age, before.age, 'Paused physics must not consume recovery time.');
        assert.deepEqual(after.joints, before.joints, 'Paused joints must remain exactly fixed.');
        await physicsPage.locator('#resume-button').click();
        await physicsPage.locator('#pause-screen').waitFor({ state: 'hidden' });
      });

      await check('fallen player cannot walk, borrow a car, pop confetti, or restart the fall', async () => {
        const before = await bodyState(physicsPage);
        assertFiniteBody(before);
        await physicsPage.keyboard.press('e');
        await fireToy(physicsPage);
        await physicsPage.keyboard.press('f');
        await physicsPage.keyboard.down('d');
        await physicsPage.waitForTimeout(200);
        await physicsPage.keyboard.up('d');
        const after = await bodyState(physicsPage);
        assertFiniteBody(after);
        assert.equal(after.vehicleId, null, 'E must not enter a car while fallen.');
        assert.equal(after.actionCooldown, 0, 'Left-click must not fire the popper while fallen.');
        assert.equal(after.playerAngle, before.playerAngle, 'Walking input must not steer the fallen avatar.');
        assert.ok(after.age > before.age + 0.1, 'F must not reset an existing ragdoll recovery clock.');
      });

      await check('player ragdoll blends into getting up and automatically restores walking', async () => {
        await physicsPage.waitForFunction(() => document.getElementById('game-canvas').dataset.playerRagdoll === 'recover', null, { timeout: 4000 });
        const recovering = await bodyState(physicsPage);
        assertFiniteBody(recovering);
        assert.ok(recovering.recovery >= 0 && recovering.recovery < 1, 'Getting up must interpolate a physical pose.');
        await physicsPage.waitForFunction(() => document.getElementById('game-canvas').dataset.playerRagdoll === 'none', null, { timeout: 2500 });
        await waitForFreshFrames(physicsPage);
        assert.equal(await bodyState(physicsPage), null);
        assert.equal(await physicsPage.evaluate(() => globalThis.__browserCheckScene._player.group.visible), true);
        const before = await sceneState(physicsPage);
        await physicsPage.keyboard.down('w');
        await physicsPage.waitForTimeout(180);
        await physicsPage.keyboard.up('w');
        const after = await sceneState(physicsPage);
        assert.ok(Math.hypot(after.worldX - before.worldX, after.worldY - before.worldY) > 3, 'Walking must resume after getting up.');
        await physicsPage.screenshot({ path: path.join(evidence, 'desktop-recovered.png'), fullPage: true });
      });

      await check('R immediately clears a fall and returns the player to usable controls', async () => {
        await physicsPage.waitForFunction(() => globalThis.__browserCheckGame.player.ragdollGrace <= 0, null, { timeout: 2500 });
        await physicsPage.keyboard.press('f');
        await physicsPage.waitForFunction(() => document.getElementById('game-canvas').dataset.playerRagdoll === 'fall', null, { timeout: 2000 });
        await physicsPage.keyboard.press('r');
        await physicsPage.waitForFunction(() => {
          const data = document.getElementById('game-canvas').dataset;
          return data.playerRagdoll === 'none' && globalThis.__browserCheckScene._player.group.visible;
        }, null, { timeout: 2000 });
        assert.equal(await bodyState(physicsPage), null);
        const before = await sceneState(physicsPage);
        await physicsPage.keyboard.down('w');
        await physicsPage.waitForTimeout(180);
        await physicsPage.keyboard.up('w');
        const after = await sceneState(physicsPage);
        assert.ok(Math.hypot(after.worldX - before.worldX, after.worldY - before.worldY) > 3, 'R must restore movement immediately.');
      });

      await check('a real left mouse pop gives a nearby resident a physical confetti tumble', async () => {
        // Arrange a clear, close target only in this isolated test page. Fire
        // through the real captured mouse, fixed step and WebGL renderer.
        const id = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, ped = game.peds[0], car = game.cars[0];
          game.physics.clearAll(); game.peds = [ped]; game.cars = [car]; game.police = [];
          game.heat = 0; game._actionCooldown = 0;
          const lane = globalThis.__browserCheckLane();
          Object.assign(car, { ...lane.point(-150, 25), angle: lane.angle, speed: 0, vx: 0, vy: 0, traffic: false });
          game.vehiclePhysics.reset(car);
          Object.assign(game.player, { ...lane.point(), angle: lane.angle, verticalVelocity: 0, grounded: true, vehicleId: null });
          Object.assign(ped, { ...lane.point(36), stunned: 0, ragdollGrace: 0, pace: 0 });
          ped.homeX = ped.x; ped.homeY = ped.y;
          globalThis.__browserCheckPopHeading = lane.angle;
          return ped.id;
        });
        await captureMouse(physicsPage);
        await physicsPage.keyboard.press('c');
        await physicsPage.waitForFunction(() => Math.abs(Math.atan2(Math.sin(globalThis.__browserCheckScene.viewYaw - globalThis.__browserCheckPopHeading), Math.cos(globalThis.__browserCheckScene.viewYaw - globalThis.__browserCheckPopHeading))) < 0.05, null, { timeout: 2500 });
        await fireToy(physicsPage);
        await physicsPage.waitForFunction(pedId => {
          const body = globalThis.__browserCheckGame.physics.get(pedId);
          return body?.phase === 'fall' && Number(document.getElementById('game-canvas').dataset.renderedRagdolls) > 0;
        }, id, { timeout: 2500 });
        assert.ok(await physicsPage.evaluate(() => globalThis.__browserCheckGame.particles.length > 0), 'Impact should burst confetti.');
        await physicsPage.waitForFunction(pedId => globalThis.__browserCheckGame.physics.get(pedId)?.age >= 0.85, id, { timeout: 2000 });
        const resident = await bodyState(physicsPage, id);
        assertFiniteBody(resident);
        assert.equal(resident.vehicleId, null);
        assert.equal(await physicsPage.evaluate(() => globalThis.__browserCheckScene._player.group.visible), true);
        diagnostics.residentRagdoll = resident;
        await physicsPage.screenshot({ path: path.join(evidence, 'desktop-resident-ragdoll.png'), fullPage: true });
        await physicsPage.waitForFunction(pedId => !globalThis.__browserCheckGame.physics.get(pedId), id, { timeout: 4000 });
        await waitForFreshFrames(physicsPage);
        assert.equal(await physicsPage.evaluate(pedId => globalThis.__browserCheckScene._residents.get(pedId).group.visible, id), true, 'Resident must return to the standing model after getting up.');
      });

      await check('driving into a resident launches a rendered physical body', async () => {
        await physicsPage.keyboard.press('r');
        await waitForFreshFrames(physicsPage);
        const fixture = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0], ped = game.peds[0];
          game.cars = [car]; game.police = []; game.peds = [ped];
          const lane = globalThis.__browserCheckLane();
          Object.assign(car, { ...lane.point(), angle: lane.angle, speed: 0, vx: 0, vy: 0, traffic: false, health: 100 });
          game.vehiclePhysics.reset(car);
          Object.assign(game.player, { ...lane.point(0, -32), angle: lane.angle, vehicleId: null, verticalVelocity: 0, grounded: true });
          Object.assign(ped, { ...lane.point(62), stunned: 0, ragdollGrace: 0, pace: 0 });
          ped.homeX = ped.x; ped.homeY = ped.y;
          return { id: ped.id, ux: lane.ux, uy: lane.uy };
        });
        const id = fixture.id;
        await physicsPage.keyboard.press('e');
        await waitForScene(physicsPage, 'drive');
        await physicsPage.keyboard.down('w');
        try {
          await physicsPage.waitForFunction(pedId => globalThis.__browserCheckGame.physics.get(pedId)?.phase === 'fall', id, { timeout: 3000 });
        } finally { await physicsPage.keyboard.up('w'); }
        const early = await bodyState(physicsPage, id);
        await physicsPage.waitForTimeout(300);
        const moved = await bodyState(physicsPage, id);
        assertFiniteBody(moved);
        assert.notDeepEqual(moved.joints, early.joints, 'Vehicle impact must impart physical motion to the body.');
        assert.ok((moved.joints.pelvis.x - early.joints.pelvis.x) * fixture.ux + (moved.joints.pelvis.z - early.joints.pelvis.z) * fixture.uy > 0.2, 'Body should move away from the front of the car.');
        assert.equal((await sceneState(physicsPage)).cameraMode, 'drive');
        diagnostics.vehicleRagdoll = moved;
        await physicsPage.screenshot({ path: path.join(evidence, 'desktop-vehicle-ragdoll.png'), fullPage: true });
      });

      await check('a driven car collides with a parked rigid body and transfers momentum without passing through it', async () => {
        await physicsPage.keyboard.press('r');
        await waitForFreshFrames(physicsPage);
        const fixture = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0];
          game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0;
          const lane = globalThis.__browserCheckLane();
          Object.assign(car, { ...lane.point(), angle: lane.angle, traffic: false, health: 100 });
          game.vehiclePhysics.reset(car);
          const ahead = lane.point(70), blocker = game._addCar(ahead.x, ahead.y, lane.angle, 'compact', '#67d3c8', false);
          game.vehiclePhysics.sync(); game.vehiclePhysics.reset(blocker);
          globalThis.__browserCheckContacts = [];
          game.vehiclePhysics.bodies.get(car.id).body.addEventListener('collide', event => {
            if (event.body.entity) globalThis.__browserCheckContacts.push({ other: event.body.entity.id, closing: Math.abs(event.contact.getImpactVelocityAlongNormal()) });
          });
          Object.assign(game.player, { ...lane.point(0, -32), grounded: true, angle: lane.angle, vehicleId: null });
          return { x: lane.x, y: lane.y, ux: lane.ux, uy: lane.uy, nx: lane.nx, ny: lane.ny };
        });
        await physicsPage.keyboard.press('e');
        await waitForScene(physicsPage, 'drive');
        await physicsPage.keyboard.down('w');
        await physicsPage.waitForTimeout(1500);
        await physicsPage.keyboard.up('w');
        const contact = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.current, blocker = game.cars[1];
          return { carX: car.x, carY: car.y, blockerX: blocker.x, blockerY: blocker.y, blockerVx: blocker.vx, blockerVy: blocker.vy, carElevation: car.elevation, blockerElevation: blocker.elevation, health: car.health, contacts: [...globalThis.__browserCheckContacts] };
        });
        const carAlong = (contact.carX - fixture.x) * fixture.ux + (contact.carY - fixture.y) * fixture.uy;
        const blockerAlong = (contact.blockerX - fixture.x) * fixture.ux + (contact.blockerY - fixture.y) * fixture.uy;
        const sidewaysGap = (contact.carX - contact.blockerX) * fixture.nx + (contact.carY - contact.blockerY) * fixture.ny;
        assert.ok(carAlong < blockerAlong, 'Driven car must not pass through the parked car.');
        assert.ok(contact.contacts.length > 0, 'The real Cannon solver must report a vehicle contact.');
        assert.ok(blockerAlong > 80 || contact.blockerVx * fixture.ux + contact.blockerVy * fixture.uy > 10, 'The parked car must receive physical momentum.');
        assert.ok(blockerAlong - carAlong > 35 || Math.abs(contact.carElevation - contact.blockerElevation) > 1.1, 'Cars must remain separated in space; airborne height can change their horizontal spacing.');
        assert.ok(carAlong > 15, 'Car should reach the obstacle under real throttle input.');
        assert.ok(Math.abs(sidewaysGap) < 20, 'A straight bumper contact should not send cars sideways across a lane.');
        diagnostics.parkedCarContact = contact;
      });

      await check('a high-speed wall impact rebounds, launches the real car and renders its full airborne rotation', async () => {
        const wall = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0];
          game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.abandonMission(); game.heat = 0;
          const wall = globalThis.__browserCheckWall();
          Object.assign(car, { ...wall.point(70), angle: wall.angle, traffic: false, health: 100 });
          game.vehiclePhysics.reset(car);
          Object.assign(game.player, { vehicleId: car.id, x: car.x, y: car.y });
          globalThis.__browserCheckContacts = [];
          game.vehiclePhysics.bodies.get(car.id).body.addEventListener('collide', event => {
            if (event.body.kind === 'building') globalThis.__browserCheckContacts.push({ kind: 'building', closing: Math.abs(event.contact.getImpactVelocityAlongNormal()) });
          });
          globalThis.__browserCheckWallNormal = { ux: wall.ux, uy: wall.uy };
          return { ...wall.building, ux: wall.ux, uy: wall.uy, center: wall.center };
        });
        await waitForScene(physicsPage, 'drive');
        await physicsPage.keyboard.press('c');
        await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.current, wall = globalThis.__browserCheckWallNormal;
          // Launch the real approach after awaited camera setup so the browser
          // observes the impact itself, rather than starting after its flight.
          Object.assign(car, { speed: 300, vx: wall.ux * 300, vy: wall.uy * 300 });
          const startTime = game.time;
          globalThis.__browserCheckWallTrace = { maxElevation: 0, maxTilt: 0, minVx: 0, maxVx: 0, samples: [] };
          function sample() {
            const trace = globalThis.__browserCheckWallTrace;
            trace.maxElevation = Math.max(trace.maxElevation, car.elevation);
            trace.maxTilt = Math.max(trace.maxTilt, Math.abs(car.orientation.x) + Math.abs(car.orientation.z));
            trace.minVx = Math.min(trace.minVx, car.vx); trace.maxVx = Math.max(trace.maxVx, car.vx);
            if (trace.samples.length < 100) trace.samples.push({ time: game.time - startTime, x: car.x, y: car.y,
              elevation: car.elevation, groundHeight: globalThis.__browserCheckGround(car), vx: car.vx, vy: car.vy,
              reverseSpeed: -(car.vx * wall.ux + car.vy * wall.uy), tilt: Math.abs(car.orientation.x) + Math.abs(car.orientation.z) });
            if (game.time - startTime < 2.5) requestAnimationFrame(sample);
          }
          requestAnimationFrame(sample);
        });
        try {
          await physicsPage.waitForFunction(() => {
            const car = globalThis.__browserCheckGame.current;
            const wall = globalThis.__browserCheckWallNormal;
            return globalThis.__browserCheckContacts.length > 0 && car.elevation - globalThis.__browserCheckGround(car) > 0.2 && car.vx * wall.ux + car.vy * wall.uy < -10 && Math.abs(car.orientation.x) + Math.abs(car.orientation.z) > 0.015;
          }, null, { timeout: 3000 });
        } finally { diagnostics.airborneWallTrace = await physicsPage.evaluate(() => ({ ...globalThis.__browserCheckWallTrace, contacts: [...globalThis.__browserCheckContacts] })); }
        const airborne = await vehicleState(physicsPage);
        assertRenderedVehicle(airborne);
        assert.ok((airborne.x - wall.center.x) * wall.ux + (airborne.y - wall.center.y) * wall.uy < -wall.w / 2, 'The car must rebound outside the solid rotated building frontage.');
        assert.ok(airborne.vx * wall.ux + airborne.vy * wall.uy < -10, 'The impact must reverse velocity along the rotated wall normal.');
        assert.ok(airborne.elevation - airborne.groundHeight > 0.2 && airborne.renderedHeight - airborne.groundHeight > 0.2, 'Physical and visible car must both leave the local road surface.');
        assert.ok(Math.abs(airborne.orientation.x) + Math.abs(airborne.orientation.z) > 0.015, 'The impact must create real pitch or roll, not only a yaw turn.');
        diagnostics.airborneWallImpact = airborne;
        await physicsPage.screenshot({ path: path.join(evidence, 'desktop-wall-rebound.png'), fullPage: true });
        await physicsPage.waitForFunction(() => { const car = globalThis.__browserCheckGame.current; return Math.abs(car.verticalVelocity) < 0.5 && car.elevation - globalThis.__browserCheckGround(car) < 0.6; }, null, { timeout: 4000 });
        assertRenderedVehicle(await vehicleState(physicsPage));
      });

      await check('a fast bumper collision sends real car bodies into visible three-dimensional flight and they fall back down', async () => {
        const fixture = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0];
          game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0;
          const lane = globalThis.__browserCheckLane();
          Object.assign(car, { ...lane.point(), angle: lane.angle, traffic: false, health: 100 });
          game.vehiclePhysics.reset(car);
          const ahead = lane.point(100), struck = game._addCar(ahead.x, ahead.y, lane.angle + Math.PI, 'compact', '#67d3c8', false);
          game.vehiclePhysics.sync(); game.vehiclePhysics.reset(struck);
          Object.assign(car, { speed: 290, vx: lane.ux * 290, vy: lane.uy * 290 });
          Object.assign(struck, { speed: 180, vx: -lane.ux * 180, vy: -lane.uy * 180 });
          Object.assign(game.player, { vehicleId: car.id, x: car.x, y: car.y });
          globalThis.__browserCheckContacts = [];
          game.vehiclePhysics.bodies.get(car.id).body.addEventListener('collide', event => {
            if (event.body.entity?.id === struck.id) globalThis.__browserCheckContacts.push({ other: struck.id, closing: Math.abs(event.contact.getImpactVelocityAlongNormal()) });
          });
          return { id: struck.id, x: ahead.x, y: ahead.y };
        });
        const struckId = fixture.id;
        await physicsPage.keyboard.press('c');
        await physicsPage.waitForFunction(() => {
          const car = globalThis.__browserCheckGame.current;
          return globalThis.__browserCheckContacts.length > 0 && car.elevation - globalThis.__browserCheckGround(car) > 0.9 && Math.abs(car.orientation.x) + Math.abs(car.orientation.z) > 0.015;
        }, null, { timeout: 3000 });
        const airborne = await vehicleState(physicsPage), struck = await vehicleState(physicsPage, struckId);
        assertRenderedVehicle(airborne); assertRenderedVehicle(struck);
        assert.ok(airborne.elevation - airborne.groundHeight > 0.9, 'The actual collision must send the driven car clearly above its local street.');
        assert.ok(Math.hypot(struck.x - fixture.x, struck.y - fixture.y) > 2 || Math.hypot(struck.vx, struck.vy) > 10, 'The struck body must receive real momentum.');
        diagnostics.airborneCarImpact = { driven: airborne, struck };
        await physicsPage.screenshot({ path: path.join(evidence, 'desktop-airborne-impact.png'), fullPage: true });
        await physicsPage.waitForFunction(() => {
          const car = globalThis.__browserCheckGame.current;
          return car.elevation - globalThis.__browserCheckGround(car) < 0.7 && Math.abs(car.verticalVelocity) < 0.5;
        }, null, { timeout: 5000 });
        assertRenderedVehicle(await vehicleState(physicsPage));
      });

      await check('an elastic collision with a fixed tree trunk rebounds without moving the obstacle', async () => {
        const obstacle = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0];
          game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0;
          let fixture;
          for (const tree of game.staticObjects.filter(object => object.kind === 'tree')) {
            for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
              const ux = Math.cos(angle), uy = Math.sin(angle);
              if ([30, 50, 70, 95, 115].every(gap => game._vehicleFree({ ...car, ...globalThis.__browserCheckPose({ x: tree.x - ux * gap, y: tree.y - uy * gap }), angle, orientation: null, upright: true }))) {
                fixture = { id: tree.id, x: tree.x, y: tree.y, angle, ux, uy }; break;
              }
            }
            if (fixture) break;
          }
          if (!fixture) throw new Error('The generated world needs one clear tree approach for elastic prop collision.');
          Object.assign(car, { x: fixture.x - fixture.ux * 115, y: fixture.y - fixture.uy * 115, angle: fixture.angle, traffic: false, health: 100 });
          game.vehiclePhysics.reset(car);
          Object.assign(car, { speed: 210, vx: fixture.ux * 210, vy: fixture.uy * 210 });
          Object.assign(game.player, { vehicleId: car.id, x: car.x, y: car.y });
          globalThis.__browserCheckContacts = [];
          game.vehiclePhysics.bodies.get(car.id).body.addEventListener('collide', event => {
            if (event.body.kind === 'tree') globalThis.__browserCheckContacts.push({ kind: 'tree', closing: Math.abs(event.contact.getImpactVelocityAlongNormal()) });
          });
          globalThis.__browserCheckPropNormal = fixture;
          return fixture;
        });
        await physicsPage.waitForFunction(() => { const car = globalThis.__browserCheckGame.current, prop = globalThis.__browserCheckPropNormal;
          return globalThis.__browserCheckContacts.length > 0 && car.vx * prop.ux + car.vy * prop.uy < -5;
        }, null, { timeout: 3000 });
        const bounced = await vehicleState(physicsPage);
        assertRenderedVehicle(bounced);
        assert.ok((bounced.x - obstacle.x) * obstacle.ux + (bounced.y - obstacle.y) * obstacle.uy < 0, 'The fixed trunk must stop the car on its approaching side.');
        assert.ok(bounced.vx * obstacle.ux + bounced.vy * obstacle.uy < -5, 'The prop must create a reverse impulse, not merely remove speed.');
        assert.deepEqual(await physicsPage.evaluate(id => { const tree = globalThis.__browserCheckGame.staticObjects.find(object => object.id === id); return { x: tree.x, y: tree.y }; }, obstacle.id), { x: obstacle.x, y: obstacle.y }, 'The static trunk must remain anchored.');
        diagnostics.fixedPropBounce = bounced;
      });

      await check('R rights a flipped physical car, resets angular motion and returns usable real driving controls', async () => {
        await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0], lane = globalThis.__browserCheckLane();
          game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0; game.graceTimer = 120;
          Object.assign(car, { ...lane.point(), angle: lane.angle, health: game.maxHealth, traffic: false, vx: 0, vy: 0, speed: 0, orientation: null });
          game.vehiclePhysics.reset(car, car);
          Object.assign(game.player, { ...lane.point(0, -32), angle: lane.angle, vehicleId: null, verticalVelocity: 0, grounded: true });
        });
        await captureMouse(physicsPage); await physicsPage.keyboard.press('e'); await waitForScene(physicsPage, 'drive');
        await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.current;
          const lane = globalThis.__browserCheckLane();
          Object.assign(car, { ...lane.point(), angle: lane.angle, elevation: lane.point().elevation + 0.8, verticalVelocity: 0, vx: 0, vy: 0, speed: 0,
            orientation: { x: 1, y: 0, z: 0, w: 0 } });
        });
        await waitForFreshFrames(physicsPage);
        const flipped = await vehicleState(physicsPage);
        assert.equal(flipped.upright, false, 'The setup must produce an actual inverted vehicle before recovery.');
        assertRenderedVehicle(flipped);
        await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, recover = game.recover;
          game.recover = function (...args) {
            const result = recover.apply(this, args), body = this.vehiclePhysics.get(this.current.id);
            globalThis.__browserCheckRecoveryReset = { linear: body.velocity.length(), angular: body.angularVelocity.length(), upright: this.current.upright };
            return result;
          };
        });
        await physicsPage.keyboard.press('r');
        await waitForFreshFrames(physicsPage);
        const reset = await physicsPage.evaluate(() => globalThis.__browserCheckRecoveryReset);
        const recovered = await vehicleState(physicsPage);
        diagnostics.flippedCarRecovery = { ...recovered, reset };
        assertRenderedVehicle(recovered);
        assert.equal(recovered.upright, true);
        assert.equal(recovered.grounded, true, 'Recovered car must remain supported by its local sloping road.');
        assert.ok(Math.abs(recovered.elevation - recovered.groundHeight) < 0.25, 'Recovery must place the physical car back on its local road.');
        assert.ok(reset && reset.upright && reset.linear < 0.0001 && reset.angular < 0.0001, 'The actual recovery call must clear real linear and angular motion before terrain contacts settle.');
        const start = { x: recovered.x, y: recovered.y };
        await physicsPage.keyboard.down('w');
        await physicsPage.waitForTimeout(250);
        await physicsPage.keyboard.up('w');
        const driven = await vehicleState(physicsPage);
        assert.ok(Math.hypot(driven.x - start.x, driven.y - start.y) > 4, 'Recovered car must respond to actual throttle input.');
        assert.ok(driven.health > 0);
        diagnostics.flippedCarRecovery = { ...recovered, reset, driven };
      });
    } finally { await closeTestContext(physicsContext); }
    const inventoryContext = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
    try {
      await inventoryContext.route('**/*', route => {
        if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
        externalRequests.push(route.request().url());
        return route.abort();
      });
      await installEngineInspection(inventoryContext);
      const inventoryPage = await inventoryContext.newPage();
      inventoryPage.on('pageerror', error => errors.push(error.message));
      inventoryPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await inventoryPage.goto(url);
      await inventoryPage.locator('#play-button').click();
      await waitForScene(inventoryPage, 'foot');

      await check('I opens pockets anywhere, freezes play, and keeps keyboard focus inside the dialog', async () => {
        await openInventory(inventoryPage);
        assert.equal(await inventoryPage.locator('#pockets-panel').isVisible(), true);
        assert.equal(await inventoryPage.locator('[data-buy-gadget="hammer"]').isDisabled(), true, 'Shopping should require the garage.');
        assert.equal(await inventoryPage.locator('[data-buy-pocket="biscuits"]').isDisabled(), true);
        await inventoryPage.waitForTimeout(100);
        const before = await inventoryState(inventoryPage);
        await inventoryPage.keyboard.press('w');
        for (let i = 0; i < 18; i++) {
          await inventoryPage.keyboard.press('Tab');
          assert.equal(await inventoryPage.locator('#inventory-screen').evaluate(dialog => dialog.contains(document.activeElement)), true, 'Tab must stay in the open inventory.');
        }
        await inventoryPage.waitForTimeout(250);
        const after = await inventoryState(inventoryPage);
        assert.equal(after.time, before.time, 'Browsing pockets must freeze the simulation.');
        assert.deepEqual(after.player, before.player, 'Menu input must not move or enter a car.');
        await closeInventory(inventoryPage);
        await waitForFreshFrames(inventoryPage);
      });

      await check('pockets release virtual pointer capture and clear held aim and movement', async () => {
        await captureMouse(inventoryPage);
        await inventoryPage.mouse.down({ button: 'right' });
        await inventoryPage.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'true');
        await inventoryPage.keyboard.down('w');
        await openInventory(inventoryPage);
        assert.equal(await inventoryPage.evaluate(() => document.pointerLockElement), null);
        await inventoryPage.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'false');
        assert.equal((await sceneState(inventoryPage)).aiming, 'false');
        const paused = await inventoryState(inventoryPage);
        await closeInventory(inventoryPage);
        await inventoryPage.waitForTimeout(200);
        const resumed = await inventoryState(inventoryPage);
        assert.deepEqual(resumed.player, paused.player, 'Closing a menu must not restore keys held before it opened.');
        assert.equal(await inventoryPage.evaluate(() => document.pointerLockElement), null);
        assert.equal(await inventoryPage.locator('#mouse-hint').isVisible(), true);
        assert.equal((await sceneState(inventoryPage)).aiming, 'false');
        await inventoryPage.keyboard.up('w');
        await inventoryPage.mouse.up({ button: 'right' });
      });

      await check('biscuits restore composure, while full composure and an absent car cannot waste supplies', async () => {
        await openInventory(inventoryPage);
        const original = await inventoryState(inventoryPage);
        assert.equal(original.composure, 100);
        assert.equal(await inventoryPage.locator('[data-use-pocket="biscuits"]').isDisabled(), true);
        assert.equal(await inventoryPage.locator('[data-use-pocket="repairTape"]').isDisabled(), true);
        assert.equal(await inventoryPage.locator('[data-use-pocket="refill"]').isDisabled(), true, 'A locked cannon cannot consume its refill.');
        await inventoryPage.evaluate(() => { globalThis.__browserCheckGame.player.composure = 55; });
        await inventoryPage.waitForFunction(() => !document.querySelector('[data-use-pocket="biscuits"]').disabled);
        await inventoryPage.locator('[data-use-pocket="biscuits"]').click();
        const used = await inventoryState(inventoryPage);
        assert.equal(used.composure, 95);
        assert.equal(used.inventory.pockets.biscuits, original.inventory.pockets.biscuits - 1);
        assert.equal(used.inventory.pockets.repairTape, original.inventory.pockets.repairTape);
        await inventoryPage.evaluate(() => { globalThis.__browserCheckGame.player.composure = 100; });
        await inventoryPage.waitForFunction(() => document.querySelector('[data-use-pocket="biscuits"]').disabled);
        assert.equal((await inventoryState(inventoryPage)).inventory.pockets.biscuits, used.inventory.pockets.biscuits);
        await closeInventory(inventoryPage);
      });

      await check('garage shopping unlocks two toys, charges their prices, and caps pocket stacks', async () => {
        // Arrange a quiet service visit without bypassing any purchase, menu,
        // save, renderer, or player input behavior.
        await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0];
          globalThis.__inventoryCheckPed = game.peds[0];
          game.cars = [car]; game.peds = []; game.police = []; game.physics.clearAll();
          const visit = globalThis.__browserCheckService();
          Object.assign(car, { ...visit.car, speed: 0, vx: 0, vy: 0, traffic: false });
          game.vehiclePhysics.reset(car);
          Object.assign(game.player, { ...visit.garage, angle: visit.car.angle, verticalVelocity: 0, grounded: true, vehicleId: null });
          game.money = 1500; game.heat = 0;
        });
        await openInventory(inventoryPage);
        await inventoryPage.waitForFunction(() => !document.querySelector('[data-buy-gadget="hammer"]').disabled);
        const before = await inventoryState(inventoryPage);
        await inventoryPage.locator('[data-buy-gadget="hammer"]').click();
        const hammer = await inventoryState(inventoryPage);
        assert.equal(hammer.money, before.money - 120);
        assert.ok(hammer.inventory.unlocked.includes('hammer'));
        await inventoryPage.locator('[data-buy-gadget="cannon"]').click();
        const cannon = await inventoryState(inventoryPage);
        assert.equal(cannon.money, hammer.money - 280);
        assert.deepEqual(cannon.inventory.unlocked, ['popper', 'hammer', 'cannon']);
        assert.equal(cannon.inventory.ammo.cannon, 6);
        assert.equal(await inventoryPage.locator('[data-buy-gadget="hammer"]').isDisabled(), true, 'Owned toys cannot be purchased twice.');
        for (const [item, cap, price] of [['biscuits', 5, 15], ['repairTape', 3, 35], ['refill', 3, 30]]) {
          const start = await inventoryState(inventoryPage);
          const bought = cap - start.inventory.pockets[item];
          for (let n = 0; n < bought; n++) await inventoryPage.locator(`[data-buy-pocket="${item}"]`).click();
          const end = await inventoryState(inventoryPage);
          assert.equal(end.inventory.pockets[item], cap);
          assert.equal(end.money, start.money - bought * price);
          assert.equal(await inventoryPage.locator(`[data-buy-pocket="${item}"]`).isDisabled(), true, `${item} should stop at its stack cap.`);
        }
        await inventoryPage.locator('[data-use-pocket="refill"]').click();
        const filled = await inventoryState(inventoryPage);
        assert.equal(filled.inventory.ammo.cannon, 12);
        assert.equal(filled.inventory.pockets.refill, 2);
        assert.equal(await inventoryPage.locator('[data-use-pocket="refill"]').isDisabled(), true, 'A full cannon must not waste a refill.');
        await inventoryPage.locator('.inventory-scroll').evaluate(element => { element.scrollTop = 0; });
        await inventoryPage.waitForFunction(() => !document.getElementById('toast').classList.contains('visible'), null, { timeout: 5000 });
        await inventoryPage.screenshot({ path: path.join(evidence, 'desktop-inventory-pockets.png'), fullPage: true });
        await closeInventory(inventoryPage);
      });

      await check('hold Tab freezes contracts and physical bodies; release equips the selected toy without movement leaking', async () => {
        await equipWithWheel(inventoryPage, 1);
        await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame;
          game.acceptMission('delivery');
          const ped = globalThis.__inventoryCheckPed;
          const lane = globalThis.__browserCheckLane();
          Object.assign(ped, { ...lane.point(60), angle: lane.angle, pace: 0, stunned: 0, ragdollGrace: 0, bubble: '', bubbleTimer: 0 });
          ped.homeX = ped.x; ped.homeY = ped.y;
          game.peds = [ped];
          game._knockDown(ped, { x: 2, y: 2.5, z: 0 });
        });
        await captureMouse(inventoryPage);
        await inventoryPage.mouse.down({ button: 'right' });
        await inventoryPage.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'true');
        await inventoryPage.keyboard.down('Tab');
        await inventoryPage.locator('#toy-wheel').waitFor({ state: 'visible' });
        assert.equal(await inventoryPage.evaluate(() => document.pointerLockElement), null, 'The wheel must release virtual pointer capture.');
        await inventoryPage.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'false');
        assert.equal((await sceneState(inventoryPage)).aiming, 'false');
        await inventoryPage.mouse.up({ button: 'right' });
        await inventoryPage.keyboard.press('ArrowRight');
        await inventoryPage.waitForTimeout(80);
        const before = await inventoryState(inventoryPage);
        assert.equal(before.inventory.equipped, 'popper', 'The wheel must wait for release to equip.');
        await inventoryPage.keyboard.down('w');
        await inventoryPage.keyboard.press('Space');
        await inventoryPage.waitForTimeout(400);
        const frozen = await inventoryState(inventoryPage);
        assert.equal(frozen.time, before.time);
        assert.equal(frozen.missionTime, before.missionTime);
        assert.deepEqual(frozen.bodies, before.bodies, 'The wheel must also freeze ragdoll recovery.');
        assert.deepEqual(frozen.player, before.player);
        assert.equal(frozen.projectiles, 0);
        await inventoryPage.waitForFunction(() => !document.getElementById('toast').classList.contains('visible'), null, { timeout: 5000 });
        await inventoryPage.screenshot({ path: path.join(evidence, 'desktop-toy-wheel.png'), fullPage: true });
        // Releasing the wheel must clear movement keys that were held in it.
        await inventoryPage.keyboard.up('Tab');
        await inventoryPage.locator('#toy-wheel').waitFor({ state: 'hidden' });
        await inventoryPage.waitForTimeout(170);
        const equipped = await inventoryState(inventoryPage);
        await inventoryPage.keyboard.up('w');
        assert.equal(equipped.inventory.equipped, 'hammer');
        assert.equal(equipped.equippedModel, 'hammer');
        assert.deepEqual(equipped.visibleToys, ['hammer'], 'The avatar must visibly hold the selected toy.');
        assert.deepEqual(equipped.player, before.player, 'A movement key pressed in the wheel must stay cleared after release.');
      });

      await check('Escape and window blur cancel toy selection; blur pauses without equipping', async () => {
        await inventoryPage.keyboard.down('Tab');
        await inventoryPage.locator('#toy-wheel').waitFor({ state: 'visible' });
        await inventoryPage.keyboard.press('3');
        await inventoryPage.keyboard.press('Escape');
        await inventoryPage.keyboard.up('Tab');
        assert.equal(await inventoryPage.locator('#toy-wheel').isVisible(), false);
        assert.equal(await inventoryPage.locator('#pause-screen').isVisible(), false);
        assert.equal((await inventoryState(inventoryPage)).inventory.equipped, 'hammer');
        await inventoryPage.keyboard.down('Tab');
        await inventoryPage.locator('#toy-wheel').waitFor({ state: 'visible' });
        await inventoryPage.keyboard.press('3');
        await inventoryPage.evaluate(() => window.dispatchEvent(new Event('blur')));
        await inventoryPage.keyboard.up('Tab');
        await inventoryPage.locator('#pause-screen').waitFor({ state: 'visible' });
        assert.equal(await inventoryPage.locator('#toy-wheel').isVisible(), false);
        assert.equal((await inventoryState(inventoryPage)).inventory.equipped, 'hammer');
        await inventoryPage.locator('#resume-button').click();
        await inventoryPage.locator('#pause-screen').waitFor({ state: 'hidden' });
      });

      await check('an equipped inflatable hammer bonks a resident into physical ragdoll motion without spending cannon ammo', async () => {
        const id = await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, ped = game.peds[0];
          game.physics.clearAll(); game.abandonMission(); game.heat = 0;
          const lane = globalThis.__browserCheckLane();
          Object.assign(game.player, { ...lane.point(), angle: lane.angle, vehicleId: null, ragdollGrace: 0 });
          Object.assign(game.cars[0], { ...lane.point(-150, 25), angle: lane.angle });
          game.vehiclePhysics.reset(game.cars[0]);
          Object.assign(ped, { ...lane.point(36), stunned: 0, ragdollGrace: 0, pace: 0 });
          ped.homeX = ped.x; ped.homeY = ped.y;
          globalThis.__browserCheckToyHeading = lane.angle;
          game._actionCooldown = 0;
          return ped.id;
        });
        await captureMouse(inventoryPage);
        await inventoryPage.keyboard.press('c');
        await inventoryPage.waitForFunction(() => Math.abs(Math.atan2(Math.sin(globalThis.__browserCheckScene.viewYaw - globalThis.__browserCheckToyHeading), Math.cos(globalThis.__browserCheckScene.viewYaw - globalThis.__browserCheckToyHeading))) < 0.05, null, { timeout: 2500 });
        const before = await inventoryState(inventoryPage);
        await fireToy(inventoryPage);
        await inventoryPage.waitForFunction(pedId => globalThis.__browserCheckGame.physics.get(pedId)?.phase === 'fall', id, { timeout: 2000 });
        await waitForFreshFrames(inventoryPage);
        assertFiniteBody(await bodyState(inventoryPage, id));
        assert.equal((await inventoryState(inventoryPage)).inventory.ammo.cannon, before.inventory.ammo.cannon);
      });

      await check('a selected Party Cannon spends one shot, renders its moving projectile, and bursts into resident ragdolls', async () => {
        const id = await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, ped = game.peds[0];
          game.physics.clearAll(); game.heat = 0; game._actionCooldown = 0;
          const lane = globalThis.__browserCheckLane();
          Object.assign(game.player, { ...lane.point(-50), angle: lane.angle });
          Object.assign(ped, { ...lane.point(150), stunned: 0, ragdollGrace: 0, pace: 0 });
          ped.homeX = ped.x; ped.homeY = ped.y;
          globalThis.__browserCheckToyHeading = lane.angle;
          return ped.id;
        });
        await equipWithWheel(inventoryPage, 3);
        const before = await inventoryState(inventoryPage);
        assert.equal(before.inventory.equipped, 'cannon');
        assert.deepEqual(before.visibleToys, ['cannon']);
        await captureMouse(inventoryPage);
        await inventoryPage.keyboard.press('c');
        await inventoryPage.waitForFunction(() => Math.abs(Math.atan2(Math.sin(globalThis.__browserCheckScene.viewYaw - globalThis.__browserCheckToyHeading), Math.cos(globalThis.__browserCheckScene.viewYaw - globalThis.__browserCheckToyHeading))) < 0.05, null, { timeout: 2500 });
        await aimAtResident(inventoryPage, id);
        await inventoryPage.mouse.down({ button: 'left' });
        await inventoryPage.waitForFunction(() => globalThis.__browserCheckGame.projectiles.length > 0 && globalThis.__browserCheckScene._toyShots.count > 0, null, { timeout: 2000 });
        const launched = await inventoryState(inventoryPage);
        assert.equal(launched.inventory.ammo.cannon, before.inventory.ammo.cannon - 1);
        await inventoryPage.mouse.up({ button: 'right' });
        await inventoryPage.waitForFunction(() => document.getElementById('game-canvas').dataset.aiming === 'false');
        await inventoryPage.mouse.up({ button: 'left' });
        assert.equal((await inventoryState(inventoryPage)).inventory.ammo.cannon, before.inventory.ammo.cannon - 1, 'Releasing either button must not fire an extra shot.');
        await inventoryPage.waitForFunction(pedId => globalThis.__browserCheckGame.physics.get(pedId)?.phase === 'fall', id, { timeout: 2000 });
        await waitForFreshFrames(inventoryPage);
        assertFiniteBody(await bodyState(inventoryPage, id));
        assert.equal((await inventoryState(inventoryPage)).projectiles, 0);
        assert.ok(await inventoryPage.evaluate(() => globalThis.__browserCheckGame.particles.length > 20), 'Party impact should shower confetti.');
        diagnostics.cannon = await inventoryState(inventoryPage);
      });

      await check('repair tape restores the driven car and stops being usable at full condition', async () => {
        await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0];
          game.peds = []; game.police = []; game.physics.clearAll(); game.heat = 0;
          const visit = globalThis.__browserCheckService();
          Object.assign(car, { ...visit.car, speed: 0, vx: 0, vy: 0, traffic: false, health: 30 });
          game.vehiclePhysics.reset(car);
          Object.assign(game.player, { ...visit.player, vehicleId: null });
        });
        await inventoryPage.keyboard.press('e');
        await waitForScene(inventoryPage, 'drive');
        await openInventory(inventoryPage);
        const before = await inventoryState(inventoryPage);
        await inventoryPage.locator('[data-use-pocket="repairTape"]').click();
        assert.equal(await inventoryPage.evaluate(() => globalThis.__browserCheckGame.current.health), 85);
        assert.equal((await inventoryState(inventoryPage)).inventory.pockets.repairTape, before.inventory.pockets.repairTape - 1);
        await inventoryPage.locator('[data-use-pocket="repairTape"]').click();
        assert.equal(await inventoryPage.evaluate(() => globalThis.__browserCheckGame.current.health), 100);
        assert.equal(await inventoryPage.locator('[data-use-pocket="repairTape"]').isDisabled(), true);
        await closeInventory(inventoryPage);
      });

      await check('G opens the garage collection; storing and painting update the saved record and visible car', async () => {
        await openInventory(inventoryPage, true);
        assert.equal(await inventoryPage.locator('#collection-panel').isVisible(), true);
        assert.equal(await inventoryPage.locator('#store-car').isEnabled(), true);
        await inventoryPage.locator('#store-car').click();
        await inventoryPage.waitForFunction(() => globalThis.__browserCheckGame.garage.cars.length === 1);
        const record = (await inventoryState(inventoryPage)).garage.cars[0];
        assert.equal(record.kind, 'compact');
        assert.equal(await inventoryPage.locator(`[data-garage-id="${record.id}"]`).count(), 1);
        const paint = inventoryPage.locator(`[data-paint-car="${record.id}"][data-color="#67d3c8"]`);
        await paint.click();
        await inventoryPage.waitForFunction(id => {
          const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
          const car = game.cars.find(vehicle => vehicle.garageId === id), model = car && scene._vehicles.get(car.id);
          return game.garage.cars[0].color === '#67d3c8' && car?.color === '#67d3c8' && model?.body.color.getHexString() === '67d3c8';
        }, record.id, { timeout: 3000 });
        diagnostics.garage = await inventoryState(inventoryPage);
        await inventoryPage.screenshot({ path: path.join(evidence, 'desktop-garage-collection.png'), fullPage: true });
        await closeInventory(inventoryPage);
        await inventoryPage.keyboard.press('e');
        await waitForScene(inventoryPage, 'foot');
      });

      await check('a wrecked collected car can be repaired from the garage card before retrieval', async () => {
        await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, id = game.garage.cars[0].id;
          game.cars.find(car => car.garageId === id).health = 0;
        });
        await openInventory(inventoryPage, true);
        const before = await inventoryState(inventoryPage), id = before.garage.cars[0].id;
        assert.equal(await inventoryPage.locator(`[data-retrieve-car="${id}"]`).isDisabled(), true, 'A wreck should require a repair first.');
        await inventoryPage.locator(`[data-repair-car="${id}"]`).click();
        const repaired = await inventoryState(inventoryPage);
        assert.equal(repaired.money, before.money - 45);
        assert.equal(repaired.garage.cars[0].health, 100);
        assert.equal(await inventoryPage.evaluate(recordId => globalThis.__browserCheckGame.cars.find(car => car.garageId === recordId).health, id), 100);
        assert.equal(await inventoryPage.locator(`[data-repair-car="${id}"]`).isDisabled(), true, 'A full repair cannot be charged twice.');
        assert.equal(await inventoryPage.locator(`[data-retrieve-car="${id}"]`).isEnabled(), true);
      });

      await check('retrieving a saved ride returns one matching car with clear collisions and usable driving controls', async () => {
        await openInventory(inventoryPage, true);
        const id = (await inventoryState(inventoryPage)).garage.cars[0].id;
        await inventoryPage.locator(`[data-retrieve-car="${id}"]`).click();
        await inventoryPage.waitForFunction(recordId => {
          const game = globalThis.__browserCheckGame;
          return game.current.garageId === recordId && game.player.vehicleId !== null;
        }, id, { timeout: 3000 });
        assert.equal(await inventoryPage.evaluate(recordId => globalThis.__browserCheckGame.cars.filter(car => car.garageId === recordId).length, id), 1, 'Retrieving should never duplicate an owned ride.');
        assert.equal(await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame;
          return game._vehicleFree(game.current) && game.cars.every(car => car === game.current || !game._vehicleContact(game.current, car));
        }), true, 'Retrieved car must have a clear solid footprint.');
        if (await inventoryPage.locator('#inventory-screen').isVisible()) await closeInventory(inventoryPage);
        await waitForScene(inventoryPage, 'drive');
        const before = await sceneState(inventoryPage);
        await inventoryPage.keyboard.down('w');
        await inventoryPage.waitForTimeout(200);
        await inventoryPage.keyboard.up('w');
        const after = await sceneState(inventoryPage);
        assert.ok(Math.hypot(after.worldX - before.worldX, after.worldY - before.worldY) > 1, 'Retrieved car should respond to throttle.');
      });

      await check('releasing a collected ride frees its slot without deleting the world car or charging cash', async () => {
        const fixture = await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame;
          const visit = globalThis.__browserCheckService();
          Object.assign(game.current, { x: visit.garage.x, y: visit.garage.y, angle: visit.car.angle, speed: 0, vx: 0, vy: 0 });
          game.vehiclePhysics.reset(game.current);
          const other = game.network.pointOnRoad(visit.road.roadId, visit.road.s + visit.direction * 90);
          const car = game._addCar(other.x, other.y, other.angle, 'sports', '#fb8097', false);
          car.garageId = 'ride-2';
          game.garage.cars.push({ id: 'ride-2', kind: car.kind, color: car.color, health: car.health });
          return { worldId: car.id, original: game.garage.cars[0].id, money: game.money };
        });
        await openInventory(inventoryPage, true);
        assert.equal(await inventoryPage.locator('[data-garage-id]').count(), 2);
        await inventoryPage.locator('[data-release-car="ride-2"]').click();
        const released = await inventoryState(inventoryPage);
        assert.equal(released.money, fixture.money, 'Freeing a garage slot should cost nothing.');
        assert.equal(released.garage.cars.length, 1);
        assert.equal(released.garage.cars[0].id, fixture.original, 'Other collected rides must remain owned.');
        assert.equal(await inventoryPage.locator('[data-garage-id="ride-2"]').count(), 0);
        const world = await inventoryPage.evaluate(id => {
          const car = globalThis.__browserCheckGame.cars.find(vehicle => vehicle.id === id);
          return { exists: Boolean(car), owned: Boolean(car?.garageId), health: car?.health };
        }, fixture.worldId);
        assert.equal(world.exists, true, 'Release must retain the deployed car in town.');
        assert.equal(world.owned, false);
        assert.ok(world.health > 0);
        await closeInventory(inventoryPage);
      });

      await check('inventory and garage progress survive reload in the existing local save key', async () => {
        await openInventory(inventoryPage);
        const before = await inventoryState(inventoryPage);
        // Settings clicks call the documented save path immediately.
        await inventoryPage.locator('#sound-toggle').click();
        const saved = await inventoryPage.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
        assert.equal(saved.version, 1, 'The existing controller save envelope should remain compatible.');
        assert.equal(saved.progress.version, 2);
        assert.deepEqual(saved.progress.inventory, before.inventory);
        assert.deepEqual(saved.progress.garage, before.garage);
        await inventoryPage.reload();
        await inventoryPage.locator('#play-button').click();
        await waitForScene(inventoryPage, 'foot');
        const reloaded = await inventoryState(inventoryPage);
        assert.deepEqual(reloaded.inventory, before.inventory);
        assert.deepEqual(reloaded.garage, before.garage);
        assert.equal(reloaded.money, before.money);
        assert.equal(reloaded.equippedModel, 'cannon');
        await openInventory(inventoryPage, true);
        assert.equal(await inventoryPage.locator('[data-garage-id]').count(), 1);
        assert.equal(await inventoryPage.locator('[data-retrieve-car]').isDisabled(), true, 'A saved collection is browsable away from the garage, but retrieval requires a visit.');
        assert.equal(await inventoryPage.locator('[data-release-car]').isDisabled(), true, 'Ownership changes should also require a garage visit.');
        await closeInventory(inventoryPage);
      });

      await check('inventory remains usable at narrow mobile and short desktop sizes', async () => {
        for (const viewport of [{ width: 390, height: 844 }, { width: 1365, height: 450 }]) {
          await inventoryPage.setViewportSize(viewport);
          await openInventory(inventoryPage);
          assert.equal(await inventoryPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
          await inventoryPage.locator('#collection-tab').click();
          await inventoryPage.locator('[data-garage-id]').waitFor({ state: 'visible' });
          await inventoryPage.locator('#pockets-tab').click();
          await inventoryPage.locator('[data-pocket="refill"]').scrollIntoViewIfNeeded();
          assert.equal(await inventoryPage.locator('[data-pocket="refill"]').isVisible(), true);
          await inventoryPage.screenshot({ path: path.join(evidence, `inventory-${viewport.width}x${viewport.height}.png`), fullPage: true });
          await closeInventory(inventoryPage);
          await inventoryPage.locator('#game-canvas').scrollIntoViewIfNeeded();
          await inventoryPage.keyboard.down('Tab');
          await inventoryPage.locator('#toy-wheel').waitFor({ state: 'visible' });
          const box = await inventoryPage.locator('#wheel-options').boundingBox();
          assert.ok(box && box.width <= viewport.width, 'Toy choices must fit the narrow viewport.');
          await inventoryPage.keyboard.press('1');
          await inventoryPage.keyboard.up('Tab');
          await inventoryPage.locator('#toy-wheel').waitFor({ state: 'hidden' });
          assert.equal((await inventoryState(inventoryPage)).inventory.equipped, 'popper');
        }
        await inventoryPage.setViewportSize({ width: 1365, height: 900 });
      });
    } finally { await closeTestContext(inventoryContext); }

    await check('old version-one saves migrate with existing progress and settings intact', async () => {
      const legacyContext = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
      try {
        await installEngineInspection(legacyContext);
        await legacyContext.route('**/*', route => {
          if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
          externalRequests.push(route.request().url());
          return route.abort();
        });
        await legacyContext.addInitScript(key => localStorage.setItem(key, JSON.stringify({
          version: 1, progress: { version: 1, money: 4321, score: 66, bestScore: 100, completed: 7, upgrades: { boost: 2, armor: 1 } },
          settings: { muted: true, reducedMotion: true },
        })), saveKey);
        const legacyPage = await legacyContext.newPage();
        legacyPage.on('pageerror', error => errors.push(error.message));
        legacyPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await legacyPage.goto(url);
        await legacyPage.locator('#play-button').click();
        await waitForScene(legacyPage, 'foot');
        const migrated = await legacyPage.evaluate(() => globalThis.__browserCheckGame.exportSave());
        assert.equal(migrated.version, 2);
        assert.equal(migrated.money, 4321); assert.equal(migrated.score, 66);
        assert.equal(migrated.bestScore, 100); assert.equal(migrated.completed, 7);
        assert.deepEqual(migrated.upgrades, { boost: 2, armor: 1 });
        assert.deepEqual(migrated.inventory, { equipped: 'popper', unlocked: ['popper'], pockets: { biscuits: 2, repairTape: 1, refill: 1 }, ammo: { cannon: 0 } });
        assert.deepEqual(migrated.garage, { cars: [] });
        assert.equal(await legacyPage.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
        assert.equal(await legacyPage.locator('#motion-toggle').getAttribute('aria-pressed'), 'true');
      } finally { await closeTestContext(legacyContext); }
    });

    await check('audio produces real music, vehicle radios, engines, sirens and effects; mute, pause and saved levels work', async () => checkAudio(browser, externalRequests));
    await check('audio falls back to local synthesis when embedded generated samples are missing or corrupt', async () => checkSampleFallback(browser, externalRequests));
    await check('unavailable audio leaves Play, vehicle entry and sound settings usable', async () => checkUnavailableAudio(browser, externalRequests));
    await check('no external network requests', async () => assert.deepEqual(externalRequests, []));
    await check('no page or console errors', async () => assert.deepEqual(errors, []));
    fs.writeFileSync(path.join(evidence, 'browser-check.json'), JSON.stringify({ url, inputMode: 'virtual-pointer-lock', inputDetails: { relativeMovement: 'DOM PointerEvent', keyboardAndButtons: 'Playwright Chrome input' }, filter: checkFilter?.source || null, checks, diagnostics, errors, externalRequests }, null, 2) + '\n');
    const failed = checks.filter(result => !result.passed).length;
    process.stdout.write(`\n${checks.length - failed}/${checks.length} browser checks passed${checkFilter ? ' (filtered run)' : ''}. Evidence: ${evidence}\n`);
    if (failed) process.exitCode = 1;
  } finally {
    await Promise.allSettled(browser.contexts().map(releaseTestPointer));
    await browser.close();
  }
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});

module.exports = { createTestContext, releaseTestPointer, closeTestContext, installEngineInspection, captureMouse, lookCamera };
