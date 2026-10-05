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
  const launch = { headless: true };
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
    await check('E borrows the nearby yellow car', async () => {
      await page.keyboard.press('e');
      await page.waitForFunction(() => document.getElementById('ride-name').textContent === 'Lemon Buggy', null, { timeout: 2000 });
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
        assert.match(await blockedPage.locator('#toast').textContent(), /Saving is unavailable/);
        await blockedPage.keyboard.press('e');
        await blockedPage.waitForFunction(() => document.getElementById('ride-name').textContent === 'Lemon Buggy', null, { timeout: 2000 });
        await blockedPage.locator('#sound-toggle').click();
        await blockedPage.locator('#motion-toggle').click();
        assert.equal(await blockedPage.locator('#game-canvas').evaluate(element => element === document.activeElement), true);
        await blockedPage.screenshot({ path: path.join(evidence, 'storage-blocked-play.png'), fullPage: true });
      } finally { await blockedContext.close(); }
    });
    await check('no external network requests', async () => assert.deepEqual(externalRequests, []));
    await check('no page or console errors', async () => assert.deepEqual(errors, []));
    fs.writeFileSync(path.join(evidence, 'browser-check.json'), JSON.stringify({ url, checks, errors, externalRequests }, null, 2) + '\n');
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
