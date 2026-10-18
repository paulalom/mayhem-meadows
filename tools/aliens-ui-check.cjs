'use strict';
// Real Chrome/WebGL and file-open loading; the desktop pointer is never captured.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTestContext, closeTestContext, installEngineInspection } = require('./browser-check.cjs');
const project = path.resolve(__dirname, '..');
const evidence = path.join(project, 'playtest-evidence', 'aliens');
function playwright() {
  for (const location of [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', 'C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
    try { return require(location); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Playwright is required. Set PLAYWRIGHT_MODULE_PATH.');
}
async function main() {
  fs.mkdirSync(evidence, { recursive: true });
  const chrome = process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await playwright().chromium.launch({ headless: true, executablePath: chrome, args: ['--enable-unsafe-swiftshader'] });
  let context;
  const errors = [], checks = [];
  try {
    context = await createTestContext(browser, { viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await installEngineInspection(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(pathToFileURL(path.join(project, 'index.html')).href);
    await page.waitForFunction(() => globalThis.__browserCheckScene && globalThis.__browserCheckGame?.aliens, null, { timeout: 30000 });
    await page.locator('#play-button').click();
    const hooked = await page.evaluate(() => {
      const game = __browserCheckGame, before = game.aliens.time;
      game.update(1 / 60, {});
      const advanced = game.aliens.time > before;
      // Keep the town still for reproducible visual inspections of the event.
      game.update = () => {};
      return advanced;
    });
    assert.equal(hooked, true);
    checks.push('live Game update advances the coordinated alien simulation');
    const initial = await page.evaluate(() => {
      const game = __browserCheckGame, scene = __browserCheckScene;
      scene.update(0, { paused: true });
      const visitors = game.peds.filter(ped => ped.alien);
      return { count: visitors.length, models: visitors.map(ped => scene._residents.get(ped.id).alien), initialTime: game.aliens.time };
    });
    assert.equal(initial.count, 4); assert.ok(initial.models.every(Boolean));
    checks.push('four disguised aliens loaded as real pedestrian models');
    await page.evaluate(() => {
      const game = __browserCheckGame, scene = __browserCheckScene, ped = game.peds.find(ped => ped.alien);
      const x = ped.x / 20, z = ped.y / 20, y = ped.elevation;
      scene._cameraStep = () => {
        scene.camera.position.set(x + Math.cos(ped.angle) * 3.3 + Math.sin(ped.angle) * 1.3, y + 1.30, z + Math.sin(ped.angle) * 3.3 - Math.cos(ped.angle) * 1.3);
        scene.camera.lookAt(x, y + 1.0, z);
      };
      scene.update(0, { paused: true });
    });
    await page.locator('#game-canvas').screenshot({ path: path.join(evidence, 'disguised-walker.png') });
    const lift = await page.evaluate(() => {
      const game = __browserCheckGame, scene = __browserCheckScene, system = game.aliens;
      const originalCount = game.peds.length;
      if (!system.startVisit()) throw new Error('No safe city target');
      const entry = { x: system.saucer.x, y: system.saucer.y };
      const phases = new Set();
      for (let i = 0; i < 10000 && system.saucer.phase !== 'beam'; i++) { system.step(1 / 60); phases.add(system.saucer.phase); }
      if (system.saucer.phase !== 'beam') throw new Error('Failed to reach beam: ' + system.saucer.phase);
      for (let i = 0; i < 190; i++) system.step(1 / 60);
      scene.update(0, { paused: true });
      const capture = system.capture, model = scene._alienSaucer;
      const x = system.saucer.x / 20, z = system.saucer.y / 20, ground = capture.origin.elevation;
      scene._cameraStep = () => {
        scene.camera.position.set(x + 21, ground + 10, z + 23);
        scene.camera.lookAt(x, ground + 10, z);
      };
      scene.update(0, { paused: true });
      return { originalCount, count: game.peds.length, entry, phase: system.saucer.phase, beam: model.beam.visible,
        pilot: !model.pilot.costume, glazing: model.window.material.opacity, progress: capture.progress,
        ground, elevation: capture.elevation, displayed: scene._residents.get(capture.ped.id).group.visible, phases: [...phases] };
    });
    assert.equal(lift.count, lift.originalCount - 1); assert.equal(lift.phase, 'beam');
    assert.ok(lift.beam && lift.pilot && lift.glazing < .3 && lift.progress > .2 && lift.displayed && lift.elevation > lift.ground + 2);
    assert.ok(lift.entry.x < 0 || lift.entry.y < 0 || lift.entry.y > 8000);
    checks.push('saucer arrives from map edge and raises a civilian in a visible beam');
    await page.locator('#game-canvas').screenshot({ path: path.join(evidence, 'beam-abduction.png') });
    await page.evaluate(() => {
      const scene = __browserCheckScene, state = __browserCheckGame.aliens.saucer;
      const x = state.x / 20, z = state.y / 20;
      scene._cameraStep = () => {
        scene.camera.position.set(x + Math.cos(state.angle) * 5.5 + Math.sin(state.angle) * .6, state.elevation + 1.8, z + Math.sin(state.angle) * 5.5 - Math.cos(state.angle) * .6);
        scene.camera.lookAt(x, state.elevation + 1.6, z);
      };
      scene.update(0, { paused: true });
    });
    await page.locator('#game-canvas').screenshot({ path: path.join(evidence, 'visible-pilot.png') });
    const completion = await page.evaluate(() => {
      const game = __browserCheckGame, scene = __browserCheckScene, system = game.aliens;
      const captured = system.capture.ped;
      for (let i = 0; i < 15000 && (system.saucer.visible || system.capture); i++) system.step(1 / 60);
      scene.update(0, { paused: true });
      const before = system.time;
      for (let i = 0; i < 10; i++) scene.update(.05, { paused: true });
      return { count: game.peds.length, returned: game.peds.filter(ped => ped === captured).length, visible: system.saucer.visible,
        paused: before === system.time, phase: system.saucer.phase, beam: scene._alienSaucer.beam.visible };
    });
    assert.equal(completion.count, lift.originalCount); assert.equal(completion.returned, 1);
    assert.equal(completion.visible, false); assert.equal(completion.beam, false); assert.equal(completion.paused, true);
    checks.push('saucer leaves, resident returns exactly once, and paused renders never advance events');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(evidence, 'checks.json'), JSON.stringify({ checks, initial, lift, completion, errors }, null, 2) + '\n');
    for (const check of checks) process.stdout.write('PASS ' + check + '\n');
  } finally {
    if (context) await closeTestContext(context);
    await browser.close();
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
