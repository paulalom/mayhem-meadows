'use strict';

// Real Chrome keyboard/UI integration with an isolated save and the shared
// virtual pointer fixture. Scenario setup uses the live game and renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTestContext, closeTestContext, installEngineInspection } = require('./browser-check.cjs');
const project = path.resolve(__dirname, '..');
const evidence = path.join(project, 'playtest-evidence');

function loadPlaywright() {
  for (const location of [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', 'C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
    try { return require(location); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Playwright is required. Set PLAYWRIGHT_MODULE_PATH if needed.');
}

async function main() {
  const errors = [], externalRequests = [], checks = [];
  const chrome = process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (!fs.existsSync(chrome)) throw new Error('Chrome is required. Set BROWSER_EXECUTABLE to its executable.');
  fs.mkdirSync(evidence, { recursive: true });
  const browser = await loadPlaywright().chromium.launch({ executablePath: chrome, headless: true, args: ['--enable-unsafe-swiftshader'] });
  let context;
  try {
    context = await createTestContext(browser, { viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await installEngineInspection(context);
    await context.route('**/*', route => {
      if (/^https?:/.test(route.request().url())) { externalRequests.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const ready = () => page.waitForFunction(() => globalThis.__browserCheckScene && Number(document.getElementById('game-canvas').dataset.frames) > 2, null, { timeout: 60000 });
    const check = async (name, action) => { await action(); checks.push(name); process.stdout.write(`PASS ${name}\n`); };
    const binding = action => page.locator(`#control-bindings [data-action="${action}"]`);
    const savedControls = () => page.evaluate(() => JSON.parse(localStorage.getItem('mayhem-meadows.v1')).settings.controls);
    const holdUntil = async (key, predicate, argument) => {
      await page.keyboard.down(key);
      try { await page.waitForFunction(predicate, argument, { timeout: 10000 }); }
      finally { await page.keyboard.up(key); }
    };
    const freshFrames = async () => {
      const before = await page.locator('#game-canvas').getAttribute('data-frames');
      await page.waitForFunction(frame => Number(document.getElementById('game-canvas').dataset.frames) > Number(frame) + 2, before);
    };

    await page.goto(pathToFileURL(path.join(project, 'index.html')).href); await ready();
    await check('settings opens before Play and traps keyboard focus', async () => {
      await page.locator('#settings-toggle').click();
      assert.equal(await page.locator('#settings-screen').isVisible(), true);
      assert.equal(await page.locator('#start-screen').isVisible(), true);
      await page.locator('#settings-motion').focus(); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'close-settings');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-motion');
    });
    await check('key capture rejects conflicts and reserved menus, cancels, and resets a set', async () => {
      await binding('throttleUp').click(); await page.keyboard.press('KeyT');
      assert.equal(await binding('throttleUp').textContent(), 'T');
      await binding('throttleDown').click(); await page.keyboard.press('KeyT');
      assert.match(await page.locator('#control-message').textContent(), /already used/);
      await page.keyboard.press('Escape');
      assert.equal(await binding('throttleDown').textContent(), 'Space');
      assert.equal(await page.locator('#settings-screen').isVisible(), true);
      await binding('throttleDown').click(); await page.keyboard.press('KeyP');
      assert.match(await page.locator('#control-message').textContent(), /menus|reserved/);
      await page.keyboard.press('Escape');
      await page.locator('#reset-controls').click();
      assert.equal(await binding('throttleUp').textContent(), 'Shift');
      assert.equal(await binding('throttleDown').textContent(), 'Space');
    });
    await check('independent custom keys and presets survive reload', async () => {
      await binding('yawLeft').click(); await page.keyboard.press('KeyZ');
      await page.locator('#control-type').selectOption('car');
      await binding('up').click(); await page.keyboard.press('KeyT');
      await page.locator('#control-type').selectOption('helicopter');
      await page.locator('#control-preset').selectOption('arrows');
      const saved = await savedControls();
      assert.deepEqual(saved.car.bindings.up, ['KeyT']);
      assert.deepEqual(saved.plane.bindings.yawLeft, ['KeyZ']);
      assert.equal(saved.helicopter.preset, 'arrows');
      await page.reload(); await ready();
      await page.locator('#settings-toggle').click();
      assert.equal(await binding('yawLeft').textContent(), 'Z');
      await page.locator('#control-type').selectOption('car');
      assert.equal(await binding('up').textContent(), 'T');
      await page.locator('#control-type').selectOption('helicopter');
      assert.equal(await page.locator('#control-preset').inputValue(), 'arrows');
      await page.locator('#control-type').selectOption('plane');
      await page.locator('#reset-controls').click();
    });
    await check('settings fits desktop and narrow screens', async () => {
      await page.locator('#settings-screen').screenshot({ path: path.join(evidence, 'controls-settings-desktop.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#settings-screen').scrollIntoViewIfNeeded();
      const bounds = await page.locator('.settings-card').evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, scroll: element.scrollWidth, client: element.clientWidth };
      });
      assert.ok(bounds.left >= 0 && bounds.right <= 390 && bounds.scroll <= bounds.client + 1, JSON.stringify(bounds));
      await page.locator('#settings-screen').screenshot({ path: path.join(evidence, 'controls-settings-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 1050 });
    });
    await page.locator('#close-settings').click(); await page.locator('#play-button').click();
    await page.waitForFunction(() => globalThis.__browserCheckGame.time > 0);
    await check('settings pauses a running town and closing resumes it', async () => {
      await page.locator('#settings-toggle').click();
      const before = await page.evaluate(() => globalThis.__browserCheckGame.time);
      await page.keyboard.press('KeyW'); await freshFrames();
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.time), before);
      await page.locator('#close-settings').click();
      await page.waitForFunction(time => globalThis.__browserCheckGame.time > time, before);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'game-canvas');
    });
    await check('settings opened from pause preserves the paused state', async () => {
      await page.keyboard.press('KeyP');
      await page.locator('#pause-settings').click();
      const before = await page.evaluate(() => globalThis.__browserCheckGame.time);
      await page.keyboard.press('Escape'); await freshFrames();
      assert.equal(await page.locator('#pause-screen').isVisible(), true);
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.time), before);
      await page.locator('#resume-button').click();
    });

    const posePlane = async (grounded = false) => {
      await page.evaluate(onGround => {
        const game = globalThis.__browserCheckGame;
        const aircraft = game.aircraft.find(value => value.aircraftType === 'trainer' && !value.npc);
        if (!aircraft) throw new Error('A player trainer must be available.');
        globalThis.__controlsCheckPlane = aircraft;
        game.heat = 0; game.graceTimer = 30;
        Object.assign(game.player, { vehicleId: aircraft.id, parachuting: false, grounded: onGround });
        if (onGround) {
          if (!game.aviation.recover(aircraft)) throw new Error('The trainer needs a clear stand for exit checks.');
        } else {
          const model = MayhemAircraft.getModel(aircraft);
          Object.assign(aircraft, { x: 6000, y: 4000, elevation: 120, angle: 0, speed: model.maxSpeed * .7,
            throttle: .7, grounded: false, vz: 0, verticalVelocity: 0, roll: 0, pitch: 0, npc: false });
        }
      }, grounded);
      await page.locator('#game-canvas').focus();
    };
    await check('plane Shift and Space adjust persistent throttle without pitch aliases', async () => {
      await posePlane();
      const before = await page.evaluate(() => __controlsCheckPlane.throttle);
      await holdUntil('ShiftLeft', value => __controlsCheckPlane.throttle > value + .1, before);
      const held = await page.evaluate(() => __controlsCheckPlane.throttle);
      await freshFrames();
      assert.equal(await page.evaluate(() => __controlsCheckPlane.throttle), held);
      assert.equal(await page.evaluate(() => __controlsCheckPlane.pitch), 0);
      await holdUntil('Space', value => __controlsCheckPlane.throttle < value - .1, held);
      assert.equal(await page.evaluate(() => __controlsCheckPlane.pitch), 0);
    });
    await check('plane W/S pitch and A/D bank independently of Q/E rudder', async () => {
      for (const [key, sign] of [['KeyW', -1], ['KeyS', 1]]) {
        await posePlane();
        await holdUntil(key, direction => __controlsCheckPlane.vz * direction > .5, sign);
        assert.equal(await page.evaluate(() => __controlsCheckPlane.throttle), .7);
      }
      for (const [key, sign] of [['KeyA', -1], ['KeyD', 1]]) {
        await posePlane();
        await holdUntil(key, direction => __controlsCheckPlane.roll * direction > .2 && __controlsCheckPlane.angle * direction > .05, sign);
      }
      for (const [key, sign] of [['KeyQ', -1], ['KeyE', 1]]) {
        await posePlane();
        await holdUntil(key, direction => __controlsCheckPlane.angle * direction > .1, sign);
        assert.equal(await page.evaluate(() => __controlsCheckPlane.roll), 0);
      }
    });
    await check('plane E yaws on the ground, X exits, and classic preset restores E exit', async () => {
      await posePlane(true);
      const heading = await page.evaluate(() => __controlsCheckPlane.angle);
      await holdUntil('KeyE', before => Math.abs(Math.atan2(Math.sin(__controlsCheckPlane.angle - before), Math.cos(__controlsCheckPlane.angle - before))) > .1, heading);
      assert.equal(await page.evaluate(() => __browserCheckGame.player.vehicleId), await page.evaluate(() => __controlsCheckPlane.id));
      await posePlane(true); await page.keyboard.press('KeyX');
      await page.waitForFunction(() => !__browserCheckGame.player.vehicleId);
      await page.locator('#settings-toggle').click();
      await page.locator('#control-type').selectOption('plane');
      await page.locator('#control-preset').selectOption('legacy');
      await page.locator('#close-settings').click();
      await posePlane(true); await page.keyboard.press('KeyE');
      await page.waitForFunction(() => !__browserCheckGame.player.vehicleId);
    });
    await check('settings and flight run offline without browser errors', async () => {
      assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []);
    });
    fs.writeFileSync(path.join(evidence, 'controls-browser-check.json'), JSON.stringify({ browser: 'Chrome', checks, errors, externalRequests }, null, 2) + '\n');
    process.stdout.write(`${checks.length} controls UI checks passed. Evidence: ${evidence}\n`);
  } finally { if (context) await closeTestContext(context); await browser.close(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
