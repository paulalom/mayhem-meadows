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
      await page.waitForFunction(() => document.getElementById('ride-name').textContent === 'Lemon Buggy', null, { timeout: 2000 });
      const state = await waitForScene(page, 'drive');
      assert.ok(state.cameraDistance > 3, 'Driving camera should pull back to show the whole ride.');
    });
    await check('exiting a ride switches back to the foot camera', async () => {
      await page.waitForTimeout(350);
      await page.keyboard.press('e');
      await waitForScene(page, 'foot');
      assert.notEqual(await page.locator('#ride-name').textContent(), 'Lemon Buggy');
      await page.waitForTimeout(350);
      await page.keyboard.press('e');
      await waitForScene(page, 'drive');
      assert.equal(await page.locator('#ride-name').textContent(), 'Lemon Buggy');
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
      assert.equal(await page.locator('#ride-name').textContent(), 'Lemon Buggy');
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
        await blockedPage.waitForFunction(() => document.getElementById('ride-name').textContent === 'Lemon Buggy', null, { timeout: 2000 });
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
          const game = globalThis.__browserCheckGame, ped = game.peds[0];
          game.player.x = 884; game.player.y = 1080; game.player.angle = -Math.PI / 2;
          ped.x = 884; ped.y = 1044; ped.homeX = ped.x; ped.homeY = ped.y; ped.stunned = 0; ped.ragdollGrace = 0;
          return ped.id;
        });
        await physicsPage.mouse.move(8, 8);
        await physicsPage.keyboard.press('c');
        await physicsPage.waitForTimeout(250);
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
