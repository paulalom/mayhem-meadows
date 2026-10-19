'use strict';

// Focused, optional real-Chrome gameplay and visual check. Uses the shared
// isolated pointer fixture, so no automated input captures the desktop cursor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTestContext, closeTestContext, installEngineInspection, captureMouse } = require('./browser-check.cjs');

async function main() {
  const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser = await playwright.chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const context = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
  const evidence = path.resolve(__dirname, '../playtest-evidence/hammer');
  const errors = [];
  fs.mkdirSync(evidence, { recursive: true });
  try {
    await installEngineInspection(context);
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.locator('#play-button').click();
    await page.waitForFunction(() => globalThis.__browserCheckScene && Number(document.getElementById('game-canvas').dataset.renderCalls) > 0);
    await page.keyboard.press('p');
    await page.locator('#pause-screen').evaluate(element => { element.style.visibility = 'hidden'; });
    await page.evaluate(() => {
      const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
      const lane = globalThis.__browserCheckLane(), resident = game.peds[0];
      globalThis.__hammerLane = lane;
      globalThis.__hammerEvents = [];
      globalThis.__hammerStage = (kind = 'person') => {
        game.physics.clearAll(); game.abandonMission(); game.heat = 0;
        game.cars = []; game.police = []; game.peds = [];
        game.particles = []; game.projectiles = []; game._hammerSwing = null;
        game._actionCooldown = 0; game._witnessReports = [];
        Object.assign(game.player, { ...lane.point(), angle: lane.angle, vehicleId: null, verticalVelocity: 0, grounded: true,
          ragdollGrace: 0, aimPitch: 0, parachuting: false, trainRide: null });
        if (!game.inventory.unlocked.includes('hammer')) game.inventory.unlocked.push('hammer');
        game.inventory.equipped = 'hammer';
        globalThis.__hammerTarget = null;
        if (kind === 'person') {
          Object.assign(resident, { ...lane.point(40), angle: lane.angle + Math.PI, homeX: lane.point(40).x,
            homeY: lane.point(40).y, stunned: 0, ragdollGrace: 0, pace: 0, bubble: '', bubbleTimer: 0,
            verticalVelocity: 0, grounded: true, mass: 75 });
          game.peds.push(resident); globalThis.__hammerTarget = resident;
        } else if (kind !== 'empty') {
          const length = globalThis.MayhemCore.CAR_TYPES[kind].length;
          const point = lane.point(40 + length / 2);
          const car = game._addCar(point.x, point.y, lane.angle, kind, '#ffd15b');
          Object.assign(car, { elevation: point.elevation, verticalVelocity: 0, grounded: true, traffic: false });
          globalThis.__hammerTarget = car;
        }
        game.vehiclePhysics.sync(); game.drainEvents(); globalThis.__hammerEvents = [];
        scene.recenter();
        for (let i = 0; i < 30; i++) scene.update(1 / 60, { paused: true, reducedMotion: false });
      };
      globalThis.__hammerAdvance = seconds => {
        for (let left = seconds; left > 1e-8; left -= 1 / 60) game.update(Math.min(1 / 60, left));
        globalThis.__hammerEvents.push(...game.drainEvents());
        scene.update(0, { paused: true, reducedMotion: false });
      };
      globalThis.__hammerSnapshot = () => {
        scene.update(0, { paused: true, reducedMotion: false });
        scene.scene.updateMatrixWorld(true);
        const target = globalThis.__hammerTarget, ragdoll = target && game.ragdolls.get(target.id), chest = ragdoll?.joints.chest;
        const chassis = target && game.vehiclePhysics.get(target.id);
        const toy = scene._player.toys.hammer;
        return { elapsed: game._hammerSwing?.elapsed ?? null, struck: Boolean(game._hammerSwing?.struck),
          arm: scene._player.rightArm.rotation.z, hammerMatrix: [...toy.matrixWorld.elements],
          particles: game.particles.length, confettiRendered: scene._confetti.count,
          bonks: globalThis.__hammerEvents.filter(event => event.type === 'sound' && event.name === 'hammer').length,
          ragdoll: chest ? { x: chest.x, y: chest.y, z: chest.z, phase: ragdoll.phase } : null,
          target: target ? { id: target.id, x: target.x, y: target.y, elevation: target.elevation, verticalVelocity: target.verticalVelocity } : null,
          vehicleVelocity: chassis ? { x: chassis.velocity.x, y: chassis.velocity.y, z: chassis.velocity.z,
            along: chassis.velocity.x * lane.ux + chassis.velocity.z * lane.uy } : null,
          drawCalls: scene.renderer.info.render.calls, renderer: scene.renderer.getContext().getParameter(scene.renderer.getContext().VERSION) };
      };
    });

    const frames = {};
    await page.evaluate(() => globalThis.__hammerStage());
    frames.ready = await page.evaluate(() => globalThis.__hammerSnapshot());
    await page.screenshot({ path: path.join(evidence, '01-ready.png') });
    assert.equal(await page.evaluate(() => globalThis.__browserCheckGame.action(globalThis.__hammerLane.angle)), true);
    await page.evaluate(() => globalThis.__hammerAdvance(.14));
    frames.windup = await page.evaluate(() => globalThis.__hammerSnapshot());
    await page.screenshot({ path: path.join(evidence, '02-windup.png') });
    assert.equal(frames.windup.particles, 0); assert.equal(frames.windup.bonks, 0); assert.equal(frames.windup.ragdoll, null);
    await page.evaluate(() => globalThis.__hammerAdvance(.08));
    frames.contact = await page.evaluate(() => globalThis.__hammerSnapshot());
    await page.screenshot({ path: path.join(evidence, '03-contact.png') });
    assert.ok(frames.contact.ragdoll, 'contact launches the resident');
    assert.ok(frames.contact.particles > 0 && frames.contact.confettiRendered > 0, 'contact renders confetti');
    assert.equal(frames.contact.bonks, 1);
    await page.evaluate(() => globalThis.__hammerAdvance(.12));
    frames.followThrough = await page.evaluate(() => globalThis.__hammerSnapshot());
    await page.screenshot({ path: path.join(evidence, '04-follow-through.png') });
    assert.ok(frames.followThrough.ragdoll.y > frames.contact.ragdoll.y + .4, 'resident visibly rises after impact');
    const flight = frames.followThrough.ragdoll, contact = frames.contact.ragdoll;
    const direction = await page.evaluate(() => ({ x: globalThis.__hammerLane.ux, z: globalThis.__hammerLane.uy }));
    assert.ok((flight.x - contact.x) * direction.x + (flight.z - contact.z) * direction.z > .5, 'resident flies away from the hammer');
    for (const [left, right] of [['ready', 'windup'], ['windup', 'contact'], ['contact', 'followThrough']]) {
      assert.ok(frames[left].hammerMatrix.some((value, index) => Math.abs(value - frames[right].hammerMatrix[index]) > .2), left + ' and ' + right + ' have visibly different hammer transforms');
    }

    const vehicles = {};
    for (const kind of ['compact', 'van', 'tank']) {
      vehicles[kind] = await page.evaluate(kind => {
        globalThis.__hammerStage(kind);
        const used = globalThis.__browserCheckGame.action(globalThis.__hammerLane.angle);
        globalThis.__hammerAdvance(.22);
        const contact = globalThis.__hammerSnapshot();
        globalThis.__hammerAdvance(.12);
        return { used, contact, airborne: globalThis.__hammerSnapshot() };
      }, kind);
      assert.equal(vehicles[kind].used, true);
      assert.ok(vehicles[kind].contact.vehicleVelocity.along > 1 && vehicles[kind].contact.vehicleVelocity.y > 1, kind + ' launches up and back');
      assert.ok(vehicles[kind].airborne.target.elevation > vehicles[kind].contact.target.elevation + .1, kind + ' visibly hops');
      assert.equal(vehicles[kind].contact.bonks, 1);
      await page.screenshot({ path: path.join(evidence, 'vehicle-' + kind + '.png') });
    }
    assert.ok(vehicles.compact.contact.vehicleVelocity.along > vehicles.van.contact.vehicleVelocity.along && vehicles.van.contact.vehicleVelocity.along > vehicles.tank.contact.vehicleVelocity.along);
    assert.ok(vehicles.compact.contact.vehicleVelocity.y > vehicles.van.contact.vehicleVelocity.y && vehicles.van.contact.vehicleVelocity.y > vehicles.tank.contact.vehicleVelocity.y);

    const worldHit = await page.evaluate(() => {
      globalThis.__hammerStage('empty');
      const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
      const fence = game.staticObjects.find(object => object.kind === 'fence' && !object.destroyed);
      const normal = { x: -Math.sin(fence.angle), y: Math.cos(fence.angle) };
      Object.assign(game.player, { x: fence.x - normal.x * 35, y: fence.y - normal.y * 35, angle: fence.angle + Math.PI / 2 });
      game.player.elevation = game._ground(game.player); scene.recenter();
      const before = { particles: game.particles.length, health: fence.health };
      const used = game.action(game.player.angle); globalThis.__hammerAdvance(.2);
      const precontact = { particles: game.particles.length, health: fence.health };
      globalThis.__hammerAdvance(.02);
      return { used, before, precontact, after: globalThis.__hammerSnapshot(), destroyed: Boolean(fence.destroyed), health: fence.health };
    });
    assert.equal(worldHit.used, true); assert.equal(worldHit.precontact.particles, 0);
    assert.equal(worldHit.precontact.health, worldHit.before.health);
    assert.ok(worldHit.after.particles > 0); assert.equal(worldHit.after.bonks, 1);
    assert.ok(worldHit.destroyed || worldHit.health < worldHit.before.health);
    await page.screenshot({ path: path.join(evidence, 'world-impact.png') });

    // Resume the actual animation loop and strike through native mouse input.
    await page.evaluate(() => globalThis.__hammerStage());
    await page.keyboard.press('p');
    await captureMouse(page);
    await page.keyboard.press('c');
    await page.waitForFunction(() => Math.abs(Math.atan2(Math.sin(globalThis.__browserCheckScene.viewYaw - globalThis.__hammerLane.angle), Math.cos(globalThis.__browserCheckScene.viewYaw - globalThis.__hammerLane.angle))) < .02);
    await page.evaluate(() => {
      const game = globalThis.__browserCheckGame;
      game._actionCooldown = 0; game._hammerSwing = null; game.particles = [];
      const original = game.action;
      game.action = function (...args) {
        const result = original.apply(this, args);
        globalThis.__hammerNativeAction = { result, elapsed: this._hammerSwing?.elapsed, particles: this.particles.length };
        return result;
      };
    });
    await page.mouse.down({ button: 'left' }); await page.mouse.up({ button: 'left' });
    await page.waitForFunction(() => globalThis.__browserCheckGame.ragdolls.get(globalThis.__hammerTarget.id)?.phase === 'fall');
    const nativeClick = await page.evaluate(() => ({ action: globalThis.__hammerNativeAction,
      ragdoll: Boolean(globalThis.__browserCheckGame.ragdolls.get(globalThis.__hammerTarget.id)),
      particles: globalThis.__browserCheckGame.particles.length,
      safePointer: globalThis.__browserInputFixture.assertSafe(),
      audioBonks: globalThis.__browserCheckAudioEvents.filter(event => event.name === 'hammer').length }));
    assert.equal(nativeClick.action.result, true); assert.equal(nativeClick.action.elapsed, 0);
    assert.equal(nativeClick.action.particles, 0); assert.ok(nativeClick.ragdoll && nativeClick.particles > 0);
    assert.equal(nativeClick.safePointer, true);
    await page.screenshot({ path: path.join(evidence, 'native-left-click.png') });
    assert.deepEqual(errors, []);
    const result = { browser: 'Chrome', frames, vehicles, worldHit, nativeClick, errors };
    fs.writeFileSync(path.join(evidence, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    await closeTestContext(context); await browser.close();
  }
}

main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
