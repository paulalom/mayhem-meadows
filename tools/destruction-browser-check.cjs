'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createTestContext, closeTestContext, installEngineInspection } = require('./browser-check.cjs');

async function main() {
  const playwright = require(process.env.PLAYWRIGHT_MODULE_PATH || 'C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser = await playwright.chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const context = await createTestContext(browser, { viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
  const errors = [];
  const evidence = path.resolve(__dirname, '../playtest-evidence/destruction');
  fs.mkdirSync(evidence, { recursive: true });
  try {
    await installEngineInspection(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.locator('#play-button').click();
    await page.waitForFunction(() => globalThis.__browserCheckScene && document.getElementById('game-canvas').dataset.liveProps);
    await page.keyboard.press('p');
    await page.locator('#pause-screen').evaluate(element => { element.style.visibility = 'hidden'; });
    const before = await page.evaluate(() => {
      const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
      const fence = game.staticObjects.find(object => object.kind === 'fence');
      const normal = { x: -Math.sin(fence.angle), y: Math.cos(fence.angle) };
      Object.assign(game.player, { x: fence.x - normal.x * 35, y: fence.y - normal.y * 35, angle: fence.angle + Math.PI / 2, vehicleId: null });
      game.player.elevation = game.world.terrain?.surfaceHeight(game.player.x, game.player.y) || 0;
      game.inventory.equipped = 'hammer'; game.inventory.unlocked.push('hammer'); game._actionCooldown = 0;
      scene.recenter(); for (let i = 0; i < 30; i++) scene.update(1 / 60, { paused: true });
      globalThis.__destructionFence = fence;
      return { id: fence.id, health: fence.health, liveProps: Number(scene.canvas.dataset.liveProps), drawCalls: scene.renderer.info.render.calls, buildings: game.buildings.length };
    });
    await page.screenshot({ path: path.join(evidence, 'before.png') });
    const after = await page.evaluate(() => {
      const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene, fence = globalThis.__destructionFence;
      const used = game.action(game.player.angle);
      game.update(.23);
      scene.update(0, { paused: true });
      const state = scene._propRenderStates.get(fence), matrix = new scene.T.Matrix4();
      const hidden = state.slots.every(slot => { slot.mesh.getMatrixAt(slot.index, matrix); return matrix.elements[0] === 0 && matrix.elements[5] === 0 && matrix.elements[10] === 0; });
      return { used, destroyed: Boolean(fence.destroyed), hidden, removedCollider: !game.vehiclePhysics.world.bodies.some(body => body.source === fence),
        debris: Number(scene.canvas.dataset.debrisCount), liveProps: Number(scene.canvas.dataset.liveProps), drawCalls: scene.renderer.info.render.calls,
        buildings: game.buildings.length, heat: game.heat, renderer: scene.renderer.getContext().getParameter(scene.renderer.getContext().VERSION) };
    });
    await page.screenshot({ path: path.join(evidence, 'after.png') });
    assert.equal(after.used, true); assert.equal(after.destroyed, true); assert.equal(after.hidden, true);
    assert.equal(after.removedCollider, true); assert.ok(after.debris > 0 && after.debris <= 120);
    assert.equal(after.liveProps, before.liveProps - 1); assert.equal(after.buildings, before.buildings); assert.ok(after.heat > 0);
    assert.ok(after.drawCalls <= before.drawCalls + 4, 'debris should remain batched');
    const stress = await page.evaluate(() => {
      const game = globalThis.__browserCheckGame, scene = globalThis.__browserCheckScene;
      for (const object of game.staticObjects) if (object.destructible) game._damageProp(object, object.maxHealth, game.player, false);
      scene.update(0, { paused: true });
      const peakDebris = Number(scene.canvas.dataset.debrisCount);
      const signsHidden = [...scene._propRenderStates].every(([object, state]) => !object.destroyed || state.signs.every(sign => !sign.visible));
      for (let i = 0; i < 300; i++) game.update(1 / 60);
      scene.update(0, { paused: true });
      return { peakDebris, signsHidden, debrisAfter: Number(scene.canvas.dataset.debrisCount), garageSolid: game.vehiclePhysics.world.bodies.some(body => body.kind === 'garage'), liveProps: Number(scene.canvas.dataset.liveProps) };
    });
    assert.equal(stress.peakDebris, 120); assert.equal(stress.signsHidden, true); assert.equal(stress.debrisAfter, 0);
    assert.equal(stress.garageSolid, true); assert.equal(stress.liveProps, 1); assert.deepEqual(errors, []);
    const result = { browser: 'Chrome', before, after, stress, errors };
    fs.writeFileSync(path.join(evidence, 'checks.json'), JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    await closeTestContext(context); await browser.close();
  }
}
main().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
