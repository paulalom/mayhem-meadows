'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTestContext, closeTestContext, installEngineInspection } = require('./browser-check.cjs');

function loadPlaywright() {
  for (const location of [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', 'C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
    try { return require(location); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Playwright is required for the Chrome train boarding check.');
}

(async () => {
  const browser = await loadPlaywright().chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const context = await createTestContext(browser, { viewport: { width: 1440, height: 1000 } });
  const evidence = path.resolve(__dirname, '../playtest-evidence/train-boarding');
  fs.mkdirSync(evidence, { recursive: true });
  const errors = [], checks = [];
  try {
    await installEngineInspection(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForFunction(() => globalThis.__browserCheckScene?._trains, null, { timeout: 60000 });
    await page.evaluate(() => {
      const game = globalThis.__browserCheckGame, system = game.railTraffic;
      game.cars = []; game.police = []; game.peds = []; game.aircraft.length = 0;
      game.player.x = 1000; game.player.y = 1000;
      for (const service of system.services.slice(1)) service.next = Infinity;
      for (let tick = 0; tick < 60 * 180 && system.services[0].state !== 'dwell'; tick++) system.step(1 / 60);
      if (system.services[0].state !== 'dwell') throw new Error('Passenger train never reached the real station.');
      // Hold the real service at the platform while exercising the keyboard.
      system.services[0].until = Infinity;
      globalThis.__placeTrainBoarder = (rear = false) => {
        const service = system.services[0], car = rear ? service.cars.at(-1) : service.cars[0];
        const offsets = rear ? [{ along: -car.railModel.length / 2 - 18, across: 0 }]
          : [-1, 1].map(side => ({ along: 0, across: side * (car.railModel.width / 2 + 18) }));
        for (const offset of offsets) {
          const c = Math.cos(car.angle), s = Math.sin(car.angle);
          const point = { x: car.x + c * offset.along - s * offset.across, y: car.y + s * offset.along + c * offset.across };
          Object.assign(game.player, point, { elevation: game._ground(point), verticalVelocity: 0, grounded: true, trainRide: null, vehicleId: null });
          if (system.boardingTarget(game.player)) return car.id;
        }
        throw new Error('No accessible train boarding point in the actual station terrain.');
      };
      globalThis.__placeTrainBoarder();
    });
    await page.locator('#play-button').click();
    await page.locator('#game-canvas').focus();
    await page.waitForFunction(() => document.getElementById('interaction-hint').textContent.includes('hop onto train'));
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => Boolean(globalThis.__browserCheckGame.ridingTrain));
    await page.waitForFunction(() => document.getElementById('interaction-hint').textContent.includes('hop off train'));
    assert.equal(await page.evaluate(() => {
      const scene = globalThis.__browserCheckScene;
      return scene._player.group.visible && scene._player.leftArm.rotation.z > 2 && Object.values(scene._player.toys).every(toy => !toy.visible);
    }), true);
    await page.locator('#game-canvas').screenshot({ path: path.join(evidence, 'side-boarding.png') });
    checks.push('E boards the station train from its side; holding pose, hidden toy and exit hint render');

    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => !globalThis.__browserCheckGame.player.trainRide);
    assert.equal(await page.evaluate(() => globalThis.__browserCheckGame._personFree(globalThis.__browserCheckGame.player.x, globalThis.__browserCheckGame.player.y)), true);
    checks.push('E exits onto clear ground');

    await page.evaluate(() => globalThis.__placeTrainBoarder(true));
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => Boolean(globalThis.__browserCheckGame.ridingTrain));
    await page.keyboard.press('KeyC');
    await page.waitForFunction(() => {
      const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
      return Math.cos(scene.cameraInfo.viewYaw - game.player.angle) > .999 &&
        document.getElementById('interaction-hint').textContent.includes('hop off train') && scene._player.leftArm.rotation.z > 2;
    });
    assert.equal(await page.evaluate(() => {
      const game = globalThis.__browserCheckGame;
      return game.player.trainRide.along < -game.ridingTrain.railModel.length / 2;
    }), true);
    await page.locator('#game-canvas').screenshot({ path: path.join(evidence, 'rear-boarding.png') });
    checks.push('E boards the exposed rear of the train');

    await page.evaluate(() => { const game = globalThis.__browserCheckGame; game.railTraffic.services[0].until = game.railTraffic.time; });
    await page.waitForFunction(() => {
      const game = globalThis.__browserCheckGame;
      return game.railTraffic.services[0].leg === 'outbound' && game.ridingTrain?.speed > 4;
    });
    await page.keyboard.down('KeyW');
    try {
      await page.waitForFunction(() => {
        const game = globalThis.__browserCheckGame;
        return game.ridingTrain?.speed > 12 && !game.ragdolls.get('player');
      });
    } finally { await page.keyboard.up('KeyW'); }
    assert.equal(await page.evaluate(() => {
      const game = globalThis.__browserCheckGame, pose = game.railTraffic.riderPose(game.player.trainRide);
      return Math.hypot(game.player.x - pose.x, game.player.y - pose.y) < .001 && game.player.vehicleId === null;
    }), true);
    checks.push('station reversal and movement input preserve the external attachment');

    await page.keyboard.press('KeyP');
    const paused = await page.evaluate(() => ({ time: globalThis.__browserCheckGame.time, pose: globalThis.__browserCheckGame.player.trainRide }));
    const frame = await page.locator('#game-canvas').getAttribute('data-frames');
    await page.waitForFunction(before => Number(document.getElementById('game-canvas').dataset.frames) > Number(before) + 3, frame);
    assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.time), paused.time);
    await page.keyboard.press('KeyP');
    await page.locator('#game-canvas').focus();
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => !globalThis.__browserCheckGame.player.trainRide);
    checks.push('pause and recovery preserve train service and release the player');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(evidence, 'browser-report.json'), JSON.stringify({ browser: 'Chrome', checks, errors }, null, 2) + '\n');
    console.log('Chrome: ' + checks.length + ' train boarding checks passed.');
  } finally { await closeTestContext(context); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
