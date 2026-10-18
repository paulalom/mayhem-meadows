'use strict';

// Optional integration check: real Chrome, real game loop, isolated save and
// virtual pointer capture. No desktop pointer capture or external network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTestContext, closeTestContext, installEngineInspection, captureMouse } = require('./browser-check.cjs');
const project = path.resolve(__dirname, '..');
const evidence = path.join(project, 'playtest-evidence');
function playwright() {
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
  const browser = await playwright().chromium.launch({ headless: true, executablePath: chrome, args: ['--enable-unsafe-swiftshader'] });
  let context;
  try {
    context = await createTestContext(browser, { viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    await installEngineInspection(context);
    await context.route('**/*', route => {
      if (/^https?:/.test(route.request().url())) { externalRequests.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const ready = async () => {
      await page.waitForFunction(() => globalThis.__browserCheckScene && Number(document.getElementById('game-canvas').dataset.frames) > 2, null, { timeout: 20000 });
    };
    const check = async (name, action) => { await action(); checks.push(name); process.stdout.write(`PASS ${name}\n`); };
    await page.goto(pathToFileURL(path.join(project, 'index.html')).href); await ready();
    await check('file-open loads all seven Blender aircraft models offline', async () => {
      const fleet = await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
        for (const aircraft of game.aircraft) aircraft.npc = false;
        for (const [i, type] of Object.keys(MayhemAircraft.AIRCRAFT_TYPES).entries()) {
          if (!game.aircraft.some(aircraft => aircraft.aircraftType === type)) game.aviation.spawn(type, { x: 9000 + i * 300, y: 1000, elevation: 80 });
        }
        scene.update(0, { paused: true });
        return Object.keys(MayhemAircraft.AIRCRAFT_TYPES).map(type => {
          const aircraft = game.aircraft.find(aircraft => aircraft.aircraftType === type), model = scene._aircraft.get(aircraft.id);
          let meshes = 0; model?.visual.traverse(node => { if (node.isMesh && node.geometry?.attributes.position?.count > 0) meshes++; });
          return { type, meshes, visible: model?.group.visible };
        });
      });
      assert.equal(fleet.length, 7); assert.ok(fleet.every(model => model.meshes > 0 && model.visible), JSON.stringify(fleet));
    });
    await page.locator('#play-button').click();
    await check('airport directions set the live compass', async () => {
      await page.locator('#airport-route').click();
      await page.waitForFunction(() => !document.getElementById('target-compass').hidden && document.getElementById('target-altitude').textContent === 'Meadows Airport');
    });
    const poseAtHelicopter = async () => {
      await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, aircraft = game.aircraft.find(value => value.aircraftType === 'helicopter');
        aircraft.npc = false; aircraft.speed = 0; aircraft.vx = aircraft.vy = aircraft.vz = 0; aircraft.throttle = 0; aircraft.grounded = true;
        aircraft.elevation = game._ground(aircraft);
        game.heat = 0; game.police.forEach(cop => { cop.x = -5000; cop.y = -5000; });
        Object.assign(game.player, { vehicleId: null, x: aircraft.x - 80, y: aircraft.y, elevation: aircraft.elevation, grounded: true, parachuting: false, verticalVelocity: 0 });
      });
      await page.locator('#game-canvas').focus(); await page.keyboard.press('KeyE');
      await page.waitForFunction(() => globalThis.__browserCheckGame.current.aircraftType === 'helicopter');
    };
    await check('E boards a parked helicopter and shows aircraft instruments', async () => {
      await poseAtHelicopter();
      await page.waitForFunction(() => !document.getElementById('flight-panel').hidden && document.getElementById('ride-name').textContent === MayhemAircraft.getModel('helicopter').name);
      assert.match(await page.locator('#flight-altitude').textContent(), /m AGL/);
      assert.match(await page.locator('#speed-caption').textContent(), /CTRL DESCEND/);
    });
    await check('airport hangar saves an aircraft, pauses flight and survives reload', async () => {
      await page.keyboard.press('KeyG');
      await page.waitForFunction(() => document.getElementById('hangar-tab').getAttribute('aria-selected') === 'true');
      await page.locator('#store-aircraft').click();
      await page.waitForFunction(() => globalThis.__browserCheckGame.hangar.aircraft.length === 1);
      assert.match(await page.locator('#hangar-count').textContent(), /1 \/ 3/);
      const before = await page.evaluate(() => globalThis.__browserCheckGame.time);
      await page.keyboard.down('Space'); await page.waitForTimeout(150); await page.keyboard.up('Space');
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.time), before);
      await page.locator('#game-shell').screenshot({ path: path.join(evidence, 'aviation-hangar.png') });
      await page.reload(); await ready();
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.hangar.aircraft.length), 1);
      await page.locator('#play-button').click();
      await poseAtHelicopter();
    });
    await check('Space lifts, Control descends and F deploys a steerable parachute', async () => {
      await captureMouse(page);
      await page.keyboard.down('Space');
      try { await page.waitForFunction(() => globalThis.__browserCheckGame.current.altitudeAGL > 12, null, { timeout: 10000 }); }
      finally { await page.keyboard.up('Space'); }
      await page.waitForFunction(() => document.getElementById('game-canvas').dataset.cameraMode === 'flight');
      await page.keyboard.down('ControlLeft');
      try { await page.waitForFunction(() => globalThis.__browserCheckGame.current.vz < -0.1, null, { timeout: 4000 }); }
      finally { await page.keyboard.up('ControlLeft'); }
      await page.locator('#game-shell').screenshot({ path: path.join(evidence, 'aviation-flight.png') });
      await page.keyboard.press('KeyF');
      await page.waitForFunction(() => globalThis.__browserCheckGame.player.parachuting && !globalThis.__browserCheckGame.player.vehicleId);
      await page.waitForFunction(() => document.getElementById('flight-panel').hidden);
    });
    await check('all four aerial contracts and the three-tab inventory are usable', async () => {
      assert.equal(await page.locator('.air-contract').count(), 4);
      await page.locator('#hangar-toggle').click();
      await page.locator('#pockets-tab').focus(); await page.keyboard.press('End');
      assert.equal(await page.locator('#hangar-tab').getAttribute('aria-selected'), 'true');
      await page.keyboard.press('Home'); assert.equal(await page.locator('#pockets-tab').getAttribute('aria-selected'), 'true');
      await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('#collection-tab').getAttribute('aria-selected'), 'true');
      await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('#hangar-tab').getAttribute('aria-selected'), 'true');
    });
    await check('offline flight produces no external requests or browser errors', async () => { assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []); });
    fs.writeFileSync(path.join(evidence, 'aviation-ui-check.json'), JSON.stringify({ checks, errors, externalRequests }, null, 2) + '\n');
    process.stdout.write(`${checks.length} aviation UI checks passed. Evidence: ${evidence}\n`);
  } finally { if (context) await closeTestContext(context); await browser.close(); }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
