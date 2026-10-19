'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { installBrowserInputFixture } = require('./browser-input-fixture.cjs');
const candidates = [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', 'C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean);
let playwright;
for (const candidate of candidates) {
  try { playwright = require(candidate); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) throw new Error('Install Playwright or set PLAYWRIGHT_MODULE_PATH.');

async function main() {
  const browser = await playwright.chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true, args: ['--enable-unsafe-swiftshader'] });
  const errors = [], evidence = path.resolve(__dirname, '../playtest-evidence');
  fs.mkdirSync(evidence, { recursive: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(installBrowserInputFixture);
    await context.addInitScript(() => {
      let core, Scene;
      Object.defineProperty(globalThis, 'MayhemCore', { configurable: true, get: () => core, set: value => {
        core = { ...value, Game: class extends value.Game { constructor(...args) { super(...args); globalThis.checkGame = this; } } };
      } });
      Object.defineProperty(globalThis, 'MayhemScene', { configurable: true, get: () => Scene, set: value => {
        Scene = class extends value { constructor(...args) { super(...args); globalThis.checkScene = this; } };
      } });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.GARAGE_TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.locator('#play-button').click();
    await page.waitForFunction(() => document.getElementById('game-canvas').dataset.view === 'third-person-3d');
    await page.keyboard.press('p'); await page.locator('#pause-screen').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      const g = checkGame, s = g.services.find(value => value.id === 'repair'), car = g.cars[0];
      g.cars = [car]; g.police = []; g.peds = []; g.money = 500; g.heat = 0; g.graceTimer = 999;
      Object.assign(car, { x: s.x + Math.sin(s.angle) * 210, y: s.y - Math.cos(s.angle) * 210,
        angle: s.angle + Math.PI / 2, elevation: s.elevation, speed: 0, vx: 0, vy: 0 });
      g.player.vehicleId = car.id; g.player.x = car.x; g.player.y = car.y;
      g.vehiclePhysics.reset(car); g.vehiclePhysics.sync();
      checkScene._yaw = car.angle; checkScene._driveOffset = 0; checkScene._lastVehicleId = car.id; checkScene._hasCamera = false;
      document.getElementById('pause-screen').style.visibility = 'hidden';
    });
    await page.waitForFunction(() => document.getElementById('interaction-hint').textContent.includes('Drive into'));
    await page.locator('.game-shell').screenshot({ path: path.join(evidence, 'repair-garage-exterior.png') });
    assert.equal(await page.evaluate(() => checkGame.repairAvailable), false);
    await page.evaluate(() => {
      const g = checkGame, car = g.current, heading = car.angle;
      for (const [seconds, targetSpeed] of [[3, 70], [.8, 0]]) for (let t = 0; t < seconds; t += 1 / 60) {
        g.vehiclePhysics.control(car, { targetSpeed, heading }); g.vehiclePhysics.step(1 / 60);
      }
      car.health = 40; car.engineHealth = 45; car.handlingHealth = 30;
      g.heat = 2; g.player.x = car.x; g.player.y = car.y;
      checkScene._hasCamera = false;
    });
    await page.waitForFunction(() => document.getElementById('interaction-hint').textContent.includes('repair & clear heat'));
    assert.equal(await page.evaluate(() => checkGame.repairAvailable), true);
    assert.ok(await page.evaluate(() => {
      const s = checkGame.services.find(value => value.id === 'repair'), camera = checkScene.cameraInfo;
      return camera.y < s.elevation + 3.5 && camera.distance > 2 && !checkScene._insideBuilding(camera.x, camera.y, camera.z);
    }), 'the interior camera stays below the lintel and outside the solid walls');
    await page.locator('.game-shell').screenshot({ path: path.join(evidence, 'repair-garage-interior.png') });
    await page.evaluate(() => { document.getElementById('pause-screen').style.visibility = ''; });
    await page.keyboard.press('p'); await page.keyboard.press('e');
    await page.waitForFunction(() => checkGame.garageService !== null);
    await page.keyboard.press('p'); await page.locator('#pause-screen').waitFor({ state: 'visible' });
    const pausedElapsed = await page.evaluate(() => checkGame.garageService.elapsed);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => checkGame.garageService.elapsed), pausedElapsed, 'P pauses the cinematic');
    await page.evaluate(() => { document.getElementById('pause-screen').style.visibility = 'hidden'; });
    const seek = async elapsed => {
      await page.evaluate(target => {
        const g = checkGame;
        for (let remaining = target - g.garageService.elapsed; remaining > .000001; remaining -= .1) g.update(Math.min(.1, remaining));
      }, elapsed);
      await page.waitForFunction(() => {
        const door = checkScene.scene.getObjectByName('Repair garage door');
        return door && Math.abs(door.userData.closed - checkGame.garageTransition.door) < .001 &&
          Math.abs(Number(getComputedStyle(document.getElementById('garage-fade')).opacity) - checkGame.garageTransition.opacity) < .001;
      });
    };
    await seek(.45);
    assert.equal(await page.evaluate(() => checkGame.garageTransition.phase), 'closing');
    assert.equal(await page.evaluate(() => checkGame.current.health), 40);
    assert.equal(await page.evaluate(() => checkGame.money), 425);
    assert.ok(await page.evaluate(() => {
      const door = checkScene.scene.getObjectByName('Repair garage door');
      return door.userData.closed > 0 && door.userData.closed < 1;
    }), 'the rendered shutter is halfway down');
    await page.locator('.game-shell').screenshot({ path: path.join(evidence, 'repair-garage-door-closing.png') });
    await seek(1.7);
    assert.equal(await page.evaluate(() => checkGame.garageTransition.phase), 'repairing');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('garage-fade')).opacity), '1');
    assert.equal(await page.evaluate(() => checkScene.scene.getObjectByName('Repair garage door').userData.closed), 1);
    await page.locator('.game-shell').screenshot({ path: path.join(evidence, 'repair-garage-black.png') });
    await seek(2.45);
    assert.equal(await page.evaluate(() => checkGame.garageTransition.phase), 'fade-in');
    assert.ok(await page.evaluate(() => {
      const opacity = Number(getComputedStyle(document.getElementById('garage-fade')).opacity);
      return opacity > 0 && opacity < 1;
    }), 'the camera is fading back in');
    await page.locator('.game-shell').screenshot({ path: path.join(evidence, 'repair-garage-fade-in.png') });
    await seek(3.2);
    assert.equal(await page.evaluate(() => checkGame.garageTransition.phase), 'opening');
    await page.locator('.game-shell').screenshot({ path: path.join(evidence, 'repair-garage-door-opening.png') });
    await page.evaluate(() => { document.getElementById('pause-screen').style.visibility = ''; });
    await page.keyboard.press('p');
    await page.waitForFunction(() => checkGame.garageService === null);
    await page.waitForFunction(() => checkScene.scene.getObjectByName('Repair garage door').userData.closed === 0 &&
      Number(getComputedStyle(document.getElementById('garage-fade')).opacity) === 0);
    assert.deepEqual(await page.evaluate(() => ({ money: checkGame.money, engine: checkGame.current.engineHealth,
      handling: checkGame.current.handlingHealth, driving: Boolean(checkGame.player.vehicleId) })), { money: 425, engine: 100, handling: 100, driving: true });
    await page.keyboard.press('p'); await page.locator('#pause-screen').waitFor({ state: 'visible' });
    await page.evaluate(() => { document.getElementById('pause-screen').style.visibility = 'hidden'; });
    await page.locator('.game-shell').screenshot({ path: path.join(evidence, 'repair-garage-serviced.png') });
    assert.deepEqual(errors, []);
    console.log('Chrome garage check passed: drive-in workshop, closing/opening shutter, fade out/black/in, pause/resume, delayed repair, and one $75 payment.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
