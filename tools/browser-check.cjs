'use strict';

// Optional UI checks: run with `node tools/browser-check.cjs` and Playwright installed.
// Chrome is headless here. The browser context and its saves are isolated from yours.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');

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

async function sceneState(page) {
  return page.locator('#game-canvas').evaluate(canvas => {
    const numeric = ['cameraYaw', 'cameraDistance', 'worldX', 'worldY', 'frames', 'renderCalls', 'cameraX', 'cameraY', 'cameraZ', 'cameraTargetX', 'cameraTargetY', 'cameraTargetZ', 'ragdollCount', 'playerRagdollAge', 'renderedRagdolls'];
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

async function dragCamera(page, dx, dy = 0) {
  const box = await page.locator('#game-canvas').boundingBox();
  assert.ok(box, 'Game canvas has no visible bounds.');
  const x = box.x + box.width * 0.53, y = box.y + box.height * 0.56;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(200);
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

// Only this isolated test context captures the engine. Normal game pages never
// expose a debug instance. Wrapping constructors leaves the real simulation,
// renderer, controls and fixed-step loop in charge of every tested outcome.
async function installEngineInspection(context) {
  await context.addInitScript(() => {
    let core, Scene;
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
  });
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
    };
  }, id);
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
  try {
    await action();
    checks.push({ name, passed: true });
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    checks.push({ name, passed: false, error: error.message });
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
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
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
      await page.waitForTimeout(250);
      const after = await sceneState(page);
      assert.ok(after.frames > before.frames, 'Simulation frames must advance.');
      assert.ok(after.renderCalls > 0, 'The scene must draw geometry.');
      assert.ok([after.cameraX, after.cameraY, after.cameraZ, after.targetX, after.targetY, after.targetZ].every(Number.isFinite), 'Camera and target positions must be finite.');
      assert.ok(after.cameraY > after.targetY, 'Third-person view should sit above its target.');
      diagnostics.foot = after;
    });
    await waitForMinimap(page);
    await page.screenshot({ path: path.join(evidence, 'desktop-third-person-foot.png'), fullPage: true });
    await check('right mouse drag orbits the foot camera and C resets it', async () => {
      const before = await sceneState(page);
      await dragCamera(page, -70, -20);
      const after = await sceneState(page);
      assert.ok(Math.abs(angleDifference(after.cameraYaw, before.cameraYaw)) > 0.1, 'Right drag did not orbit the camera.');
      assert.equal(after.cameraMode, 'foot');
      assert.ok(after.cameraDistance > 0.4, 'Camera boom must stay outside the avatar.');
      await page.keyboard.press('c');
      await page.waitForFunction(expectedYaw => {
        const yaw = Number(document.getElementById('game-canvas').dataset.cameraYaw);
        return Math.abs(Math.atan2(Math.sin(yaw - expectedYaw), Math.cos(yaw - expectedYaw))) < 0.08;
      }, defaultFootYaw, { timeout: 2500 });
      const reset = await sceneState(page);
      assert.ok(Math.abs(angleDifference(reset.cameraYaw, defaultFootYaw)) < 0.08, 'C should restore the view behind the initial player heading.');
    });
    await check('W walks in the direction of an orbited camera', async () => {
      await dragCamera(page, -60);
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
    });
    await check('E borrows the nearby yellow car', async () => {
      await page.keyboard.press('e');
      await page.waitForFunction(() => document.getElementById('ride-name').textContent === 'Pocket Rocket', null, { timeout: 2000 });
      const state = await waitForScene(page, 'drive');
      assert.ok(state.cameraDistance > 3, 'Driving camera should pull back to show the whole ride.');
    });
    await check('exiting a ride switches back to the foot camera', async () => {
      await page.waitForTimeout(350);
      await page.keyboard.press('e');
      await waitForScene(page, 'foot');
      assert.notEqual(await page.locator('#ride-name').textContent(), 'Pocket Rocket');
      await page.waitForTimeout(350);
      await page.keyboard.press('e');
      await waitForScene(page, 'drive');
      assert.equal(await page.locator('#ride-name').textContent(), 'Pocket Rocket');
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
      assert.equal(await page.locator('#ride-name').textContent(), 'Pocket Rocket');
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
    await check('blocked local storage still permits Play and car entry', async () => {
      const blockedContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
      try {
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
        await blockedPage.waitForFunction(() => document.getElementById('ride-name').textContent === 'Pocket Rocket', null, { timeout: 2000 });
        await blockedPage.locator('#sound-toggle').click();
        await blockedPage.locator('#motion-toggle').click();
        assert.equal(await blockedPage.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
        await blockedPage.screenshot({ path: path.join(evidence, 'storage-blocked-play.png'), fullPage: true });
      } finally { await blockedContext.close(); }
    });
    await check('missing WebGL 2 shows a friendly renderer message without uncaught errors', async () => {
      const unsupportedContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
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
      } finally { await unsupportedContext.close(); }
    });
    await check('the camera stays outside building walls during a full near-wall orbit', async () => {
      const wallContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
      try {
        await wallContext.route('**/*', route => {
          if (/^(file|data|blob):/.test(route.request().url())) return route.continue();
          externalRequests.push(route.request().url());
          return route.abort();
        });
        const wallPage = await wallContext.newPage();
        wallPage.on('pageerror', error => errors.push(error.message));
        wallPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await wallPage.goto(url);
        await wallPage.locator('#play-button').click();
        await waitForScene(wallPage, 'foot');
        // The first street has a building wall at x=840; A approaches it using
        // real player input, while the simulation's collision prevents entry.
        await wallPage.keyboard.down('a');
        await wallPage.waitForTimeout(450);
        await wallPage.keyboard.up('a');
        await wallPage.waitForTimeout(250);
        const nearWall = await sceneState(wallPage);
        assert.ok(nearWall.worldX >= 849 && nearWall.worldX < 875, 'The avatar should approach the west wall without entering it.');
        for (let step = 0; step < 13; step++) {
          await dragCamera(wallPage, -85);
          const state = await sceneState(wallPage);
          assert.ok(state.cameraDistance > 0.4 && state.cameraDistance < 12, 'Camera boom length must remain usable.');
          assert.ok([state.cameraX, state.cameraY, state.cameraZ].every(Number.isFinite), 'Camera coordinates must stay finite.');
          // All nearby building bodies are at least 4.5 scene units tall.
          // The test keeps the standard low foot camera below that roof line.
          const insideWestWall = state.cameraX > 30 && state.cameraX < 42 && state.cameraZ > 48 && state.cameraZ < 60 && state.cameraY < 4.5;
          assert.equal(insideWestWall, false, `Camera entered the west building on orbit step ${step}.`);
        }
        await wallPage.screenshot({ path: path.join(evidence, 'desktop-near-wall-orbit.png'), fullPage: true });
      } finally { await wallContext.close(); }
    });
    const physicsContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
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
        assert.ok(fallen.joints.head.y < 1.25, 'Gravity should bring the head below standing height.');
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
        await physicsPage.keyboard.press('Space');
        await physicsPage.keyboard.press('f');
        await physicsPage.keyboard.down('d');
        await physicsPage.waitForTimeout(200);
        await physicsPage.keyboard.up('d');
        const after = await bodyState(physicsPage);
        assertFiniteBody(after);
        assert.equal(after.vehicleId, null, 'E must not enter a car while fallen.');
        assert.equal(after.actionCooldown, 0, 'Space must not fire the popper while fallen.');
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

      await check('a real Space pop gives a nearby resident a physical confetti tumble', async () => {
        // Arrange a clear, close target only in this isolated test page. Fire
        // through the real keyboard handler, fixed step and WebGL renderer.
        const id = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, ped = game.peds[0], car = game.cars[0];
          game.physics.clearAll(); game.peds = [ped]; game.cars = [car]; game.police = [];
          game.heat = 0; game._actionCooldown = 0;
          Object.assign(car, { x: 1260, y: 180, speed: 0, vx: 0, vy: 0, traffic: false });
          game.player.x = 884; game.player.y = 1080; game.player.angle = -Math.PI / 2;
          ped.x = 884; ped.y = 1044; ped.homeX = ped.x; ped.homeY = ped.y; ped.stunned = 0; ped.ragdollGrace = 0; ped.pace = 0;
          return ped.id;
        });
        await physicsPage.mouse.move(8, 8);
        await physicsPage.keyboard.press('c');
        await physicsPage.waitForFunction(() => Math.abs(globalThis.__browserCheckScene.viewYaw + Math.PI / 2) < 0.05, null, { timeout: 2500 });
        await physicsPage.keyboard.press('Space');
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
        const id = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0], ped = game.peds[0];
          game.cars = [car]; game.police = []; game.peds = [ped];
          Object.assign(car, { x: 900, y: 1080, angle: 0, speed: 0, vx: 0, vy: 0, traffic: false, health: 100 });
          Object.assign(game.player, { x: 900, y: 1048, angle: 0, vehicleId: null });
          Object.assign(ped, { x: 962, y: 1080, homeX: 962, homeY: 1080, stunned: 0, ragdollGrace: 0 });
          return ped.id;
        });
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
        assert.ok(moved.joints.pelvis.x > early.joints.pelvis.x + 0.2, 'Body should move away from the front of the car.');
        assert.equal((await sceneState(physicsPage)).cameraMode, 'drive');
        diagnostics.vehicleRagdoll = moved;
        await physicsPage.screenshot({ path: path.join(evidence, 'desktop-vehicle-ragdoll.png'), fullPage: true });
      });

      await check('a parked car blocks the driven car at their rendered rectangular footprints', async () => {
        await physicsPage.keyboard.press('r');
        await waitForFreshFrames(physicsPage);
        await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.cars[0];
          game.peds = []; game.police = []; game.physics.clearAll();
          Object.assign(car, { x: 900, y: 1080, angle: 0, speed: 0, vx: 0, vy: 0, traffic: false, health: 100 });
          const blocker = game._addCar(970, 1080, 0, 'compact', '#67d3c8', false);
          blocker.speed = 0;
          Object.assign(game.player, { x: 900, y: 1048, angle: 0, vehicleId: null });
        });
        await physicsPage.keyboard.press('e');
        await waitForScene(physicsPage, 'drive');
        await physicsPage.keyboard.down('w');
        await physicsPage.waitForTimeout(1500);
        await physicsPage.keyboard.up('w');
        const contact = await physicsPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, car = game.current, blocker = game.cars[1];
          return { carX: car.x, carY: car.y, blockerX: blocker.x, blockerY: blocker.y, health: car.health };
        });
        assert.ok(contact.carX < contact.blockerX, 'Driven car must not pass through the parked car.');
        assert.ok(contact.blockerX - contact.carX >= 45.99, 'Compact car centers must respect both 46-unit rendered lengths.');
        assert.ok(contact.carX > 915, 'Car should reach the obstacle under real throttle input.');
        assert.ok(Math.abs(contact.carY - contact.blockerY) < 0.1);
        diagnostics.parkedCarContact = contact;
      });
    } finally { await physicsContext.close(); }
    const inventoryContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
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
          Object.assign(car, { x: 900, y: 950, angle: -Math.PI / 2, speed: 0, vx: 0, vy: 0, traffic: false });
          Object.assign(game.player, { x: 900, y: 900, angle: -Math.PI / 2, vehicleId: null });
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
          Object.assign(ped, { x: 900, y: 840, angle: 0, homeX: 900, homeY: 840, pace: 0, stunned: 0, ragdollGrace: 0, bubble: '', bubbleTimer: 0 });
          game.peds = [ped];
          game._knockDown(ped, { x: 2, y: 2.5, z: 0 });
        });
        await inventoryPage.keyboard.down('Tab');
        await inventoryPage.locator('#toy-wheel').waitFor({ state: 'visible' });
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
          Object.assign(game.player, { x: 900, y: 1080, angle: -Math.PI / 2, vehicleId: null, ragdollGrace: 0 });
          Object.assign(game.cars[0], { x: 1260, y: 180 });
          Object.assign(ped, { x: 900, y: 1044, homeX: 900, homeY: 1044, stunned: 0, ragdollGrace: 0 });
          game._actionCooldown = 0;
          return ped.id;
        });
        await inventoryPage.mouse.move(8, 8);
        await inventoryPage.keyboard.press('c');
        await inventoryPage.waitForFunction(() => Math.abs(globalThis.__browserCheckScene.viewYaw + Math.PI / 2) < 0.05, null, { timeout: 2500 });
        const before = await inventoryState(inventoryPage);
        await inventoryPage.keyboard.press('Space');
        await inventoryPage.waitForFunction(pedId => globalThis.__browserCheckGame.physics.get(pedId)?.phase === 'fall', id, { timeout: 2000 });
        await waitForFreshFrames(inventoryPage);
        assertFiniteBody(await bodyState(inventoryPage, id));
        assert.equal((await inventoryState(inventoryPage)).inventory.ammo.cannon, before.inventory.ammo.cannon);
      });

      await check('a selected Party Cannon spends one shot, renders its moving projectile, and bursts into resident ragdolls', async () => {
        const id = await inventoryPage.evaluate(() => {
          const game = globalThis.__browserCheckGame, ped = game.peds[0];
          game.physics.clearAll(); game.heat = 0; game._actionCooldown = 0;
          Object.assign(game.player, { x: 900, y: 1080, angle: -Math.PI / 2 });
          Object.assign(ped, { x: 900, y: 880, homeX: 900, homeY: 880, stunned: 0, ragdollGrace: 0 });
          return ped.id;
        });
        await equipWithWheel(inventoryPage, 3);
        const before = await inventoryState(inventoryPage);
        assert.equal(before.inventory.equipped, 'cannon');
        assert.deepEqual(before.visibleToys, ['cannon']);
        await inventoryPage.mouse.move(8, 8);
        await inventoryPage.keyboard.press('c');
        await inventoryPage.waitForFunction(() => Math.abs(globalThis.__browserCheckScene.viewYaw + Math.PI / 2) < 0.05, null, { timeout: 2500 });
        await inventoryPage.keyboard.press('Space');
        await inventoryPage.waitForFunction(() => globalThis.__browserCheckGame.projectiles.length > 0 && globalThis.__browserCheckScene._toyShots.count > 0, null, { timeout: 2000 });
        const launched = await inventoryState(inventoryPage);
        assert.equal(launched.inventory.ammo.cannon, before.inventory.ammo.cannon - 1);
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
          Object.assign(car, { x: 900, y: 950, angle: -Math.PI / 2, speed: 0, vx: 0, vy: 0, traffic: false, health: 30 });
          Object.assign(game.player, { x: 900, y: 918, angle: -Math.PI / 2, vehicleId: null });
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
          Object.assign(game.current, { x: 900, y: 900, speed: 0, vx: 0, vy: 0 });
          const car = game._addCar(990, 900, 0, 'sports', '#fb8097', false);
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
    } finally { await inventoryContext.close(); }

    await check('old version-one saves migrate with existing progress and settings intact', async () => {
      const legacyContext = await browser.newContext({ viewport: { width: 1365, height: 900 }, serviceWorkers: 'block' });
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
      } finally { await legacyContext.close(); }
    });

    await check('no external network requests', async () => assert.deepEqual(externalRequests, []));
    await check('no page or console errors', async () => assert.deepEqual(errors, []));
    fs.writeFileSync(path.join(evidence, 'browser-check.json'), JSON.stringify({ url, checks, diagnostics, errors, externalRequests }, null, 2) + '\n');
    const failed = checks.filter(result => !result.passed).length;
    process.stdout.write(`\n${checks.length - failed}/${checks.length} browser checks passed. Evidence: ${evidence}\n`);
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
