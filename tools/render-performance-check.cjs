'use strict';

// Isolated, headless render comparison; does not touch the user's browser or save.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function loadPlaywright() {
  for (const location of [process.env.PLAYWRIGHT_MODULE_PATH, 'playwright', 'C:/Users/Paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
    try { return require(location); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Playwright is required; set PLAYWRIGHT_MODULE_PATH if needed.');
}
const playwright = loadPlaywright();
const engine = process.argv[2] || 'firefox', label = process.argv[3] || 'capture';
assert.ok(['firefox', 'chrome'].includes(engine));
assert.match(label, /^[a-z0-9-]+$/i);
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'playtest-evidence/performance');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  const launch = { headless: true };
  if (engine === 'chrome') { launch.executablePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'; launch.args = ['--enable-unsafe-swiftshader']; }
  const browser = await (engine === 'firefox' ? playwright.firefox : playwright.chromium).launch(launch);
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/game.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      const game = new MayhemCore.Game({ seed: 42 });
      const scene = new MayhemScene(document.getElementById('game-canvas'), game);
      globalThis.renderBenchmark = { game, scene };
      document.getElementById('start-screen').hidden = true;
    ` }));
    if (process.env.RENDER_BENCH_SCENE) await page.route('**/scene3d.js', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.RENDER_BENCH_SCENE, 'utf8') }));
    if (process.env.RENDER_BENCH_TRAINS) await page.route('**/trains-render.js', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.RENDER_BENCH_TRAINS, 'utf8') }));
    // Firefox intercepts HTTP requests, but not file: script loads. Use the
    // local development server for an equivalent fixture in both engines.
    await page.goto(process.env.GAME_URL || 'http://127.0.0.1:4173/');
    await page.waitForFunction(() => Boolean(globalThis.renderBenchmark)).catch(error => { throw new Error(error.message + '\nPage errors: ' + errors.join('\n')); });
    const results = [];
    for (const scenario of ['foot', 'drive', 'airport']) {
      const result = await page.evaluate(async scenario => {
        const { game, scene } = globalThis.renderBenchmark;
        if (scenario === 'drive') game.player.vehicleId = game.cars[0].id;
        else game.player.vehicleId = null;
        if (scenario === 'airport') Object.assign(game.player, { x: 11060, y: 3400, elevation: game.world.terrain.surfaceHeight(11060, 3400) });
        scene._hasCamera = false; scene._requestedYaw = scene._yaw = -Math.PI / 2; scene._driveOffset = 0;
        let renderMs = 0, transformsMs = 0;
        const render = scene.renderer.render, transforms = scene.scene.updateMatrixWorld;
        scene.renderer.render = function (...args) { const time = performance.now(); const result = render.apply(this, args); renderMs += performance.now() - time; return result; };
        scene.scene.updateMatrixWorld = function (...args) { const time = performance.now(); const result = transforms.apply(this, args); transformsMs += performance.now() - time; return result; };
        const times = [], calls = [], triangles = [], distances = [];
        try {
          for (let i = 0; i < 240; i++) {
            await new Promise(requestAnimationFrame);
            scene.orbit(i < 160 ? 12 : -24, Math.sin(i * .06) * .3);
            const before = performance.now();
            scene.update(1 / 60);
            if (i === 59) { renderMs = transformsMs = 0; }
            if (i < 60) continue;
            times.push(performance.now() - before); calls.push(scene.renderer.info.render.calls); triangles.push(scene.renderer.info.render.triangles); distances.push(scene.cameraInfo.distance);
          }
        } finally { scene.renderer.render = render; scene.scene.updateMatrixWorld = transforms; }
        const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
        times.sort((a, b) => a - b);
        let objects = 0; scene.scene.traverse(() => objects++);
        const gl = scene.renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
        return { scenario, samples: times.length, meanSceneMs: mean(times), p95SceneMs: times[Math.floor(times.length * .95)],
          meanRenderMs: renderMs / times.length, meanTransformsMs: transformsMs / times.length, meanCalls: mean(calls), meanTriangles: mean(triangles),
          minCameraDistance: Math.min(...distances), maxCameraDistance: Math.max(...distances), objects,
          context: gl.getContextAttributes(), renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
      }, scenario);
      results.push(result);
      await page.locator('#game-canvas').screenshot({ path: path.join(evidence, `render-${engine}-${label}-${scenario}.png`) });
    }
    assert.deepEqual(errors, []);
    const report = { engine, version: browser.version(), label, errors, results, note: 'Headless render-only scenarios; GPU/driver and browser versions can differ from the interactive captures. Timings are diagnostics, not pass/fail limits.' };
    fs.writeFileSync(path.join(evidence, `render-${engine}-${label}.json`), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
