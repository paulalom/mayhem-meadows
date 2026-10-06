'use strict';
// Optional Chrome/WebGL integration check; the pointer fixture keeps the desktop cursor free.
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
  const chrome = process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await playwright.chromium.launch({ executablePath: chrome, headless: true, args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, serviceWorkers: 'block' });
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
    await page.goto(process.env.VEHICLE_TEST_URL || pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.locator('#play-button').click();
    await page.waitForFunction(() => document.getElementById('game-canvas').dataset.view === 'third-person-3d');
    await page.keyboard.press('p'); await page.locator('#pause-screen').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      const g = checkGame, car = g.cars[0]; g.cars = [car]; g.police = []; g.peds = [];
      g.player.vehicleId = car.id; g.player.x = car.x; g.player.y = car.y;
      car.speed = car.vx = car.vy = 0; g.graceTimer = 0;
      g.vehiclePhysics.sync();
    });
    await page.waitForFunction(() => document.getElementById('ride-name').textContent.includes('Bramble'));
    assert.match(await page.locator('#ride-stats').innerText(), /ACC .*TOP .*TURN/);
    assert.match(await page.locator('#ride-health').innerText(), /ENGINE 100%.*HANDLING 100%/);
    const healthy = await page.locator('#ride-stats').innerText();
    await page.evaluate(() => { checkGame._damageVehicle(checkGame.current, 40); });
    await page.waitForFunction(() => document.getElementById('ride-health').textContent !== 'ENGINE 100% · HANDLING 100%');
    assert.notEqual(await page.locator('#ride-stats').innerText(), healthy);
    assert.equal(await page.evaluate(() => checkScene._vehicles.get(checkGame.current.id).cracks.visible), true);
    await page.evaluate(() => { checkGame._damageVehicle(checkGame.current, 32); });
    await page.waitForFunction(() => document.getElementById('ride-status').textContent === 'On fire');
    assert.match(await page.locator('#interaction-hint').innerText(), /ENGINE FIRE.*E BAIL OUT/);
    assert.ok(await page.evaluate(() => checkScene._vehicles.get(checkGame.current.id).effects.flames.count > 0));
    await page.evaluate(() => document.getElementById('pause-screen').style.visibility = 'hidden');
    fs.mkdirSync(path.resolve(__dirname, '../playtest-evidence'), { recursive: true });
    await page.locator('.game-shell').screenshot({ path: path.resolve(__dirname, '../playtest-evidence/vehicle-fire.png') });
    await page.evaluate(() => { checkGame.usePocket('repairTape'); });
    await page.waitForFunction(() => document.getElementById('ride-status').textContent !== 'On fire');
    assert.equal(await page.evaluate(() => checkGame.current.burning), false);
    await page.evaluate(() => {
      const g = checkGame, car = g.current, garage = g.services.find(value => value.id === 'garage');
      car.x = garage.x; car.y = garage.y; car.elevation = 0; car.upright = true; car.speed = 0;
      g.player.x = car.x; g.player.y = car.y; g.player.elevation = 0; g.money = 1000;
      g.garageStore(); g._damageVehicle(car, 20);
      document.getElementById('pause-screen').style.visibility = '';
    });
    await page.keyboard.press('p'); await page.keyboard.press('g');
    await page.locator('#inventory-screen').waitFor({ state: 'visible' });
    assert.match(await page.locator('.saved-car-name').innerText(), /Bramble Pocket Rocket/);
    assert.match(await page.locator('.saved-car-condition').last().innerText(), /Accel.*top.*handling/);
    await page.locator('[data-repair-car]').click();
    assert.equal(await page.evaluate(() => checkGame.current.engineHealth), 100);
    assert.equal(await page.evaluate(() => checkGame.current.handlingHealth), 100);
    await page.keyboard.press('g'); await page.keyboard.press('p');
    await page.evaluate(() => { checkGame._explodeVehicle(checkGame.current); });
    assert.equal(await page.evaluate(() => checkGame.player.vehicleId), null);
    assert.equal(await page.evaluate(() => checkGame.cars[0].exploded), true);
    await page.waitForFunction(() => checkScene._vehicles.get(checkGame.cars[0].id).effects.flash.visible);
    await page.evaluate(() => { checkGame.time += 0.35; checkScene._cars(0); });
    await page.evaluate(() => document.getElementById('pause-screen').style.visibility = 'hidden');
    await page.locator('.game-shell').screenshot({ path: path.resolve(__dirname, '../playtest-evidence/vehicle-explosion.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const g = checkGame, car = g.cars[0]; MayhemCore.VehicleStats.repair(car, g.maxHealth);
      g.player.vehicleId = car.id; g.player.x = car.x; g.player.y = car.y;
    });
    await page.waitForFunction(() => !document.getElementById('ride-health').hidden && document.getElementById('ride-health').textContent.includes('ENGINE 100%'));
    const bounds = await page.locator('.ride-strip').evaluate(element => {
      const box = element.getBoundingClientRect(); return { x: box.x, right: box.right, width: box.width, scroll: element.scrollWidth, client: element.clientWidth,
        children: [...element.querySelectorAll('*')].map(child => ({ id: child.id, class: child.className, x: child.getBoundingClientRect().x, right: child.getBoundingClientRect().right, scroll: child.scrollWidth, client: child.clientWidth })) };
    });
    await page.locator('.game-shell').screenshot({ path: path.resolve(__dirname, '../playtest-evidence/vehicle-narrow.png') });
    assert.ok(bounds.x >= 0 && bounds.right <= 390 && bounds.scroll <= bounds.client + 1, JSON.stringify(bounds));
    assert.deepEqual(errors, []);
    console.log('Chrome checks passed: make/model HUD, degraded stats, damage visuals, fire warning, tape, garage repair, explosion, and narrow layout.');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
