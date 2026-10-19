'use strict';

// Optional integration check: real headless Chrome, offline game loop and mouse
// buttons. Saves are isolated and pointer capture uses the safe shared fixture.
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
  const checks = [], errors = [], externalRequests = [];
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
    const chromePage = await context.newCDPSession(page);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const check = async (name, action) => { await action(); checks.push(name); process.stdout.write(`PASS ${name}\n`); };
    const elapsed = async seconds => {
      const before = await page.evaluate(() => globalThis.__browserCheckGame.time);
      await page.waitForFunction(({ before, seconds }) => globalThis.__browserCheckGame.time >= before + seconds, { before, seconds }, { timeout: 20000 });
    };
    const rounds = () => page.evaluate(() => globalThis.__airWeaponShots.map(shot => ({ ...shot })));
    const pose = async type => {
      await page.mouse.up({ button: 'left' }); await page.mouse.up({ button: 'right' });
      await page.evaluate(type => {
        const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
        for (const [i, aircraft] of game.aircraft.entries()) Object.assign(aircraft, { npc: false, x: -3000, y: -3000 - i * 400, speed: 0, throttle: 0 });
        for (const cop of game.police) Object.assign(cop, { x: -5000, y: -5000 });
        game.heat = 0;
        const craft = game.aviation.spawn(type, { x: 8000, y: 5000, elevation: 180, angle: 0 });
        Object.assign(craft, { grounded: false, speed: type === 'fighter' ? 500 : 0, throttle: type === 'fighter' ? 1 / 3 : .6, flightPhase: 'cruise' });
        Object.assign(game.player, { vehicleId: craft.id, x: craft.x, y: craft.y, elevation: craft.elevation, angle: 0, grounded: false });
        Object.assign(scene, { _lastVehicleId: craft.id, _driveOffset: 0, _yaw: 0, _requestedYaw: 0, _pitch: 0, _viewPitch: 0, _orbitTimer: 1000, _hasCamera: false });
        game.aviation.aircraftProjectiles.length = 0; globalThis.__airWeaponShots.length = 0; globalThis.__rocketTrajectories.length = 0;
        scene.update(0, { paused: true });
      }, type);
      await captureMouse(page);
      await page.waitForFunction(type => globalThis.__browserCheckGame.current.aircraftType === type && document.getElementById('aim-reticle').dataset.weapon === 'aircraft', type);
    };
    const airTarget = async () => page.evaluate(() => {
      const game = globalThis.__browserCheckGame, craft = game.current;
      const target = game.aviation.spawn('helicopter', { x: craft.x + 2200, y: craft.y, elevation: craft.elevation + 3, angle: 0 });
      Object.assign(target, { grounded: false, flightPhase: 'cruise' });
      return target.id;
    });

    await page.goto(pathToFileURL(path.join(project, 'index.html')).href);
    await page.waitForFunction(() => globalThis.__browserCheckScene && Number(document.getElementById('game-canvas').dataset.frames) > 2, null, { timeout: 20000 });
    await page.evaluate(() => {
      globalThis.__airWeaponShots = [];
      globalThis.__rocketTrajectories = [];
      const game = globalThis.__browserCheckGame, projectiles = game.aviation.aircraftProjectiles;
      const push = projectiles.push;
      // Observe launch arguments without replacing any controller or projectile
      // update. This retains rounds that expire between browser assertions.
      projectiles.push = function (...shots) {
        globalThis.__airWeaponShots.push(...shots.map(shot => ({ ...shot, time: game.time, aviationTime: game.aviation.time })));
        for (const shot of shots.filter(shot => shot.weapon === 'rocket')) {
          const before = { vx: shot.vx, vy: shot.vy, vz: shot.vz, life: shot.life };
          const sample = () => {
            if (shot.life > before.life - .15) { requestAnimationFrame(sample); return; }
            globalThis.__rocketTrajectories.push({ before, after: { vx: shot.vx, vy: shot.vy, vz: shot.vz, life: shot.life } });
          };
          requestAnimationFrame(sample);
        }
        return push.apply(this, shots);
      };
    });
    await page.locator('#play-button').click();

    await check('fighter left mouse holds a continuous machine gun with visible aircraft HUD', async () => {
      await pose('fighter');
      assert.equal(await page.locator('#aim-reticle').isVisible(), true);
      assert.equal(await page.locator('#equipped-toy').isVisible(), true, 'Aircraft weapon ammo must be visible in the HUD.');
      assert.match(await page.locator('#equipped-toy').textContent(), /LEFT.*MACHINE GUN.*6\/6 MISSILES/);
      const panel = await page.locator('#equipped-panel').boundingBox();
      for (const id of ['radio-panel', 'flight-panel']) {
        const other = await page.locator(`#${id}`).boundingBox();
        assert.ok(other, `${id} should be visible in flight.`);
        assert.ok(panel.x + panel.width <= other.x || other.x + other.width <= panel.x || panel.y + panel.height <= other.y || other.y + other.height <= panel.y, `Aircraft weapons must not overlap ${id}.`);
      }
      assert.equal(await page.locator('#equipped-toy').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'Weapon text must wrap within its panel.');
      await page.mouse.down({ button: 'left' });
      try { await elapsed(.4); } finally { await page.mouse.up({ button: 'left' }); }
      const fired = await rounds();
      assert.ok(fired.filter(shot => shot.weapon === 'machine-gun').length >= 3, JSON.stringify(fired));
      assert.ok(fired.every(shot => shot.weapon === 'machine-gun'));
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.current.secondaryAmmo), 6);
      const count = fired.length; await elapsed(.3); assert.equal((await rounds()).length, count, 'Releasing left must stop the machine gun.');
    });
    await check('fighter right mouse cannot launch without a valid lock', async () => {
      await pose('fighter');
      await page.mouse.down({ button: 'right' });
      try { await elapsed(1.2); } finally { await page.mouse.up({ button: 'right' }); }
      assert.equal((await rounds()).length, 0);
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.current.secondaryAmmo), 6);
      assert.equal(await page.locator('#weapon-lock-marker').isVisible(), false);
    });
    await check('fighter right mouse shows an air lock and launches only after one second', async () => {
      await pose('fighter'); const targetId = await airTarget();
      const screenshotBounds = await page.locator('#game-shell').boundingBox();
      const before = await page.evaluate(() => globalThis.__browserCheckGame.aviation.time);
      await page.mouse.down({ button: 'right' });
      try {
        await page.waitForFunction(id => {
          const game = globalThis.__browserCheckGame, marker = document.getElementById('weapon-lock-marker');
          if (game.current.weaponLock?.targetId !== id || marker.hidden) return false;
          globalThis.__airLockCapture = { equipped: document.getElementById('equipped-toy').textContent, label: marker.textContent, shots: globalThis.__airWeaponShots.length };
          return true;
        }, targetId, { timeout: 10000 });
        // Capture Chrome's current rendered surface immediately. Playwright's
        // element screenshot waits for stability while the lock keeps advancing.
        const screenshot = await chromePage.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { ...screenshotBounds, scale: 1 } });
        fs.writeFileSync(path.join(evidence, 'aircraft-weapons.png'), Buffer.from(screenshot.data, 'base64'));
        const captured = await page.evaluate(() => globalThis.__airLockCapture);
        assert.match(captured.equipped, /LOCK.*AIR/);
        assert.match(captured.label, /\d+%/);
        assert.equal(captured.shots, 0, 'The lock indicator must appear before launch.');
        await page.waitForFunction(id => globalThis.__airWeaponShots.some(shot => shot.weapon === 'missile' && shot.targetId === id), targetId, { timeout: 15000 });
      } finally { await page.mouse.up({ button: 'right' }); }
      const missiles = (await rounds()).filter(shot => shot.weapon === 'missile'), missile = missiles[0];
      assert.ok(missile.aviationTime - before >= .98, `Missile fired early at ${missile.aviationTime - before}s.`);
      const ammo = 6 - missiles.length;
      assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.current.secondaryAmmo), ammo);
      await page.waitForFunction(() => globalThis.__browserCheckGame.current.weaponLock === null && document.getElementById('weapon-lock-marker').hidden);
      assert.match(await page.locator('#equipped-toy').textContent(), new RegExp(`${ammo}/6 MISSILES`));
      const count = (await rounds()).length; await elapsed(2.2); assert.equal((await rounds()).length, count, 'Releasing right must stop repeat missiles.');
    });
    await check('fighter locks and launches at a tank using the same right mouse input', async () => {
      await pose('fighter');
      const targetId = await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene, craft = game.current;
        const tank = game.tankTraffic._dispatch(); if (!tank) throw new Error('Could not deploy the real tank fixture.');
        tank.tankAI = false; tank.traffic = false; tank.tankPhase = 'parked';
        const ground = game._ground(tank);
        Object.assign(craft, { x: tank.x - 2100, y: tank.y, elevation: ground + 18, speed: 500, throttle: 1 / 3, angle: 0 });
        Object.assign(game.player, { x: craft.x, y: craft.y, elevation: craft.elevation, angle: 0 });
        Object.assign(scene, { _yaw: 0, _driveOffset: 0, _pitch: -.18, _viewPitch: -.18, _hasCamera: false, _orbitTimer: 1000 });
        scene.update(0, { paused: true });
        return tank.id;
      });
      await page.mouse.down({ button: 'right' });
      try {
        await page.waitForFunction(id => globalThis.__browserCheckGame.current.weaponLock?.targetId === id, targetId, { timeout: 10000 });
        assert.match(await page.locator('#equipped-toy').textContent(), /LOCK.*TANK/);
        await page.waitForFunction(id => globalThis.__airWeaponShots.some(shot => shot.weapon === 'missile' && shot.targetId === id), targetId, { timeout: 15000 });
      } finally { await page.mouse.up({ button: 'right' }); }
    });
    for (const type of ['policeheli', 'transportheli']) await check(`${type} has 24 straight rockets on right and machine gun on left`, async () => {
      await pose(type);
      assert.equal(await page.locator('#equipped-toy').isVisible(), true, 'Helicopter rocket ammo must be visible in the HUD.');
      assert.match(await page.locator('#equipped-toy').textContent(), /24\/24 ROCKETS.*STRAIGHT ROCKETS/);
      await page.evaluate(() => {
        const game = globalThis.__browserCheckGame, craft = game.current;
        const target = game.aviation.spawn('helicopter', { x: craft.x + 1000, y: craft.y + 500, elevation: craft.elevation + 30 });
        target.grounded = false;
      });
      await page.mouse.down({ button: 'left' });
      try { await elapsed(.3); } finally { await page.mouse.up({ button: 'left' }); }
      assert.ok((await rounds()).filter(shot => shot.weapon === 'machine-gun').length >= 2);
      await page.mouse.down({ button: 'right' });
      try { await elapsed(.8); } finally { await page.mouse.up({ button: 'right' }); }
      const rockets = (await rounds()).filter(shot => shot.weapon === 'rocket');
      assert.ok(rockets.length >= 3, JSON.stringify(rockets));
      assert.ok(rockets.every(shot => !shot.targetId), 'Straight rockets must have no homing target.');
      const ammo = await page.evaluate(() => globalThis.__browserCheckGame.current.secondaryAmmo);
      assert.equal(ammo, 24 - rockets.length);
      assert.match(await page.locator('#equipped-toy').textContent(), new RegExp(`${ammo}/24 ROCKETS`));
      const trajectories = await page.evaluate(() => globalThis.__rocketTrajectories);
      assert.ok(trajectories.length, 'At least one live rocket must be observed across multiple real game frames.');
      for (const trajectory of trajectories) for (const key of ['vx', 'vy', 'vz']) {
        assert.ok(trajectory.after.life > 0, 'The trajectory sample must come from a live rocket.');
        assert.equal(trajectory.after[key], trajectory.before[key], `${key} must stay straight even with an airborne target nearby.`);
      }
      const count = (await rounds()).length; await elapsed(.5); assert.equal((await rounds()).length, count, 'Releasing right must stop rockets.');
    });
    await check('pause clears held mouse fire and resume requires a new press', async () => {
      await pose('policeheli');
      await page.mouse.down({ button: 'left' }); await page.mouse.down({ button: 'right' });
      await elapsed(.2); await page.keyboard.press('KeyP');
      await page.locator('#pause-screen').waitFor({ state: 'visible' });
      const before = await page.evaluate(() => ({ time: globalThis.__browserCheckGame.time, shots: globalThis.__airWeaponShots.length, ammo: globalThis.__browserCheckGame.current.secondaryAmmo }));
      await page.waitForTimeout(200);
      assert.deepEqual(await page.evaluate(() => ({ time: globalThis.__browserCheckGame.time, shots: globalThis.__airWeaponShots.length, ammo: globalThis.__browserCheckGame.current.secondaryAmmo })), before);
      await page.mouse.up({ button: 'left' }); await page.mouse.up({ button: 'right' });
      await page.locator('#resume-button').click(); await captureMouse(page); await elapsed(.4);
      assert.equal((await rounds()).length, before.shots);
    });
    await check('offline weapons play has no external requests or browser errors', async () => { assert.deepEqual(externalRequests, []); assert.deepEqual(errors, []); });
    fs.writeFileSync(path.join(evidence, 'aircraft-weapons-browser-check.json'), JSON.stringify({ checks, inputMode: 'virtual-pointer-lock', buttonInput: 'Playwright Chrome mouse', errors, externalRequests }, null, 2) + '\n');
    process.stdout.write(`${checks.length} aircraft weapons browser checks passed. Evidence: ${evidence}\n`);
  } finally { if (context) await closeTestContext(context); await browser.close(); }
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
