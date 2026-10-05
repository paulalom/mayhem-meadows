(() => {
  'use strict';
  const { Game, SIZE, ROAD_CENTERS, ROAD_WIDTH } = MayhemCore;
  const $ = id => document.getElementById(id);
  const canvas = $('game-canvas');
  const game = new Game();
  const SAVE_KEY = 'mayhem-meadows.v1';
  const keys = new Set();
  let started = false, paused = false, helpWasPaused = false;
  let muted = false, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let audioContext, saveBlocked = false, toastUntil = 0, hudElapsed = 0, saveElapsed = 0;
  let width = 960, height = 650, scene = null, renderedFrames = 0, graphicsFailed = false;
  const aim = { x: 0, y: 0, active: false };
  let dragging = false, dragX = 0, dragY = 0;
  const money = n => '$' + Math.round(n).toLocaleString();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function toast(text, kind = '') {
    $('toast').hidden = false;
    $('toast').textContent = text;
    $('toast').dataset.kind = kind;
    $('toast').classList.add('visible');
    toastUntil = performance.now() + 4200;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (saved && saved.version === 1) {
      game.loadSave(saved.progress);
      muted = saved.settings?.muted === true;
      reducedMotion = saved.settings?.reducedMotion ?? reducedMotion;
    }
  } catch (_) { saveBlocked = true; }
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, progress: game.exportSave(), settings: { muted, reducedMotion } }));
    } catch (_) {
      if (!saveBlocked) toast('Local saving is unavailable. You can still play this session.');
      saveBlocked = true;
    }
  }
  function audioStart() {
    if (!audioContext) {
      try { audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (_) { muted = true; }
    }
    audioContext?.resume().catch(() => {});
  }
  function sound(name) {
    if (muted || !audioContext || audioContext.state !== 'running') return;
    const tones = { horn: [180, 0.18, 'sawtooth'], confetti: [650, 0.1, 'triangle'], crash: [75, 0.13, 'square'], pickup: [660, 0.14, 'sine'], complete: [880, 0.32, 'triangle'], bust: [120, 0.32, 'sawtooth'], upgrade: [1040, 0.2, 'sine'] };
    const [frequency, duration, type] = tones[name] || [420, 0.1, 'triangle'];
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const t = audioContext.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * (name === 'crash' ? 0.3 : 1.4), t + duration);
    gain.gain.setValueAtTime(0.035, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(t); oscillator.stop(t + duration);
  }
  function events() {
    for (const event of game.drainEvents()) {
      if (event.type === 'toast') toast(event.text, event.kind);
      if (event.type === 'sound') sound(event.name);
    }
  }
  function settingsUI() {
    $('sound-toggle').textContent = muted ? 'Sound: off' : 'Sound: on';
    $('sound-toggle').setAttribute('aria-pressed', String(!muted));
    $('motion-toggle').textContent = reducedMotion ? 'Motion: calm' : 'Motion: full';
    $('motion-toggle').setAttribute('aria-pressed', String(reducedMotion));
    document.body.classList.toggle('reduced-motion', reducedMotion);
  }
  function setPause(value) {
    if (!started) return;
    paused = value;
    keys.clear(); dragging = false;
    $('pause-screen').hidden = !paused;
    if (!paused) canvas.focus();
  }
  function start() {
    if (!scene || graphicsFailed) { graphicsError('This browser could not start 3D. Use a WebGL 2 capable browser with hardware acceleration enabled.'); return; }
    started = true; paused = false;
    $('start-screen').hidden = true;
    $('pause-screen').hidden = true;
    audioStart(); canvas.focus();
    toast('Press E to borrow the yellow car. Pick a gig on the right!');
    if (saveBlocked) toast('Saving is unavailable here. The full game still works this session.');
  }
  $('play-button').addEventListener('click', start);
  $('reload-button').addEventListener('click', () => location.reload());
  $('fullscreen-toggle').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector('.app').requestFullscreen();
      if (started && !paused) canvas.focus({ preventScroll: true });
    } catch (_) { toast('Full screen is unavailable in this browser.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen-toggle').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    $('fullscreen-toggle').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  });
  $('resume-button').addEventListener('click', () => { audioStart(); setPause(false); });
  $('restart-button').addEventListener('click', () => { game.recover(); setPause(false); events(); save(); });
  $('recover-button').addEventListener('click', () => { if (!started) start(); if (graphicsFailed) return; game.recover(); events(); canvas.focus(); });
  $('sound-toggle').addEventListener('click', () => { muted = !muted; audioStart(); settingsUI(); save(); if (started && !paused && $('help-screen').hidden) canvas.focus(); });
  $('motion-toggle').addEventListener('click', () => { reducedMotion = !reducedMotion; settingsUI(); save(); if (started && !paused && $('help-screen').hidden) canvas.focus(); });
  $('help-toggle').addEventListener('click', () => {
    helpWasPaused = paused;
    if (started) { paused = true; keys.clear(); }
    $('help-screen').hidden = false; $('close-help').focus();
  });
  function closeHelp() {
    $('help-screen').hidden = true;
    if (started) setPause(helpWasPaused);
  }
  $('close-help').addEventListener('click', closeHelp);
  document.querySelectorAll('.contract-button').forEach(button => button.addEventListener('click', () => {
    if (!started) start();
    if (paused || !$('help-screen').hidden) { toast('Resume the game to accept a gig.'); return; }
    game.acceptMission(button.dataset.mission); events(); canvas.focus();
  }));
  document.querySelectorAll('.purchase-button').forEach(button => button.addEventListener('click', () => {
    if (!started || paused || !$('help-screen').hidden) { toast('Visit a garage while playing to buy a tune-up.'); return; }
    game.purchase(button.dataset.upgrade); events(); save(); canvas.focus();
  }));
  $('abandon-button').addEventListener('click', () => { if (!paused && started) { game.abandonMission(); events(); canvas.focus(); } });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (!started || paused || !$('help-screen').hidden || graphicsFailed) return;
    canvas.focus({ preventScroll: true }); audioStart();
    if (event.button === 2) {
      dragging = true; dragX = event.clientX; dragY = event.clientY;
      canvas.setPointerCapture(event.pointerId); event.preventDefault();
    }
  });
  canvas.addEventListener('pointermove', event => {
    const r = canvas.getBoundingClientRect();
    aim.x = event.clientX - r.left; aim.y = event.clientY - r.top; aim.active = true;
    if (dragging && started && !paused && $('help-screen').hidden) {
      scene?.orbit(event.clientX - dragX, event.clientY - dragY);
      dragX = event.clientX; dragY = event.clientY;
    }
  });
  function stopDrag(event) {
    dragging = false;
    if (event && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('lostpointercapture', () => { dragging = false; });
  canvas.addEventListener('pointerleave', () => { if (!dragging) aim.active = false; });
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape' && !$('help-screen').hidden) { closeHelp(); return; }
    if (!started || !$('help-screen').hidden) return;
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault(); if (!event.repeat) setPause(!paused); return;
    }
    if (paused || graphicsFailed || document.activeElement !== canvas) return;
    const controlled = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space','KeyE','KeyH','KeyR','KeyC'];
    if (!controlled.includes(event.code)) return;
    event.preventDefault(); keys.add(event.code);
    if (!event.repeat) {
      if (event.code === 'KeyE') game.interact();
      if (event.code === 'KeyH') game.horn();
      if (event.code === 'KeyR') { game.recover(); scene?.recenter(); }
      if (event.code === 'KeyC') scene?.recenter();
      if (event.code === 'Space' && !game.player.vehicleId) {
        const angle = aim.active && scene ? scene.aimAngle(aim.x, aim.y, width, height) : scene?.viewYaw ?? game.player.angle;
        game.action(angle);
      }
      events();
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); if (started) setPause(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && started) { setPause(true); save(); } });
  window.addEventListener('beforeunload', save);
  settingsUI();

  function graphicsError(message) {
    graphicsFailed = true; paused = true; keys.clear(); dragging = false;
    $('renderer-error').hidden = false;
    $('renderer-error-detail').textContent = message;
    $('play-button').disabled = true;
    $('pause-screen').hidden = true;
  }
  try {
    scene = new MayhemScene(canvas, game, { reducedMotion });
    canvas.dataset.view = 'third-person-3d';
    canvas.dataset.projection = 'perspective';
  } catch (error) {
    graphicsError('3D needs WebGL 2. Enable browser hardware acceleration, then reload. Your saved progress is safe.');
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    graphicsError('The 3D graphics connection was interrupted. Reload to get back into town. Your saved progress is safe.');
  });
  const minimap = $('minimap-canvas'), mini = minimap.getContext('2d');
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    scene?.resize(width, height);
    const r = minimap.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    minimap.width = Math.max(1, Math.round(r.width * dpr));
    minimap.height = Math.max(1, Math.round(r.height * dpr));
    mini.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMinimap();
  }
  new ResizeObserver(resize).observe(canvas); resize();
  function target() { return game.mission?.targets?.[game.mission.targetIndex]; }
  function drawMinimap() {
    const r = minimap.getBoundingClientRect(), w = r.width, h = r.height, scale = w / SIZE;
    mini.clearRect(0, 0, w, h); mini.fillStyle = '#608d76'; mini.fillRect(0, 0, w, h);
    mini.fillStyle = '#3b4655';
    for (const road of ROAD_CENTERS) { mini.fillRect((road - ROAD_WIDTH / 2) * scale, 0, ROAD_WIDTH * scale, h); mini.fillRect(0, (road - ROAD_WIDTH / 2) * scale, w, ROAD_WIDTH * scale); }
    for (const service of game.services) { mini.fillStyle = service.id === 'wash' ? '#70e6db' : '#e6f77c'; mini.fillRect(service.x * scale - 2, service.y * scale - 2, 4, 4); }
    const t = target();
    if (t) { mini.strokeStyle = '#effa88'; mini.lineWidth = 2; mini.beginPath(); mini.arc(t.x * scale, t.y * scale, 5, 0, Math.PI * 2); mini.stroke(); }
    for (const police of game.police) { mini.fillStyle = game.heat ? '#ff8294' : '#a7cee4'; mini.beginPath(); mini.arc(police.x * scale, police.y * scale, 2, 0, Math.PI * 2); mini.fill(); }
    mini.save(); mini.translate(game.current.x * scale, game.current.y * scale); mini.rotate(game.current.angle);
    mini.fillStyle = '#fff8d9'; mini.beginPath(); mini.moveTo(6, 0); mini.lineTo(-4, -4); mini.lineTo(-3, 0); mini.lineTo(-4, 4); mini.closePath(); mini.fill(); mini.restore();
  }
  function render(dt) {
    if (scene && !graphicsFailed) { scene.update(dt, { reducedMotion, paused: paused || !started }); renderedFrames++; }
  }
  function hud() {
    drawMinimap();
    const camera = scene?.cameraInfo;
    if (camera) {
      canvas.dataset.cameraMode = camera.mode;
      canvas.dataset.cameraYaw = Number(camera.viewYaw ?? scene.viewYaw).toFixed(4);
      canvas.dataset.cameraDistance = Number(camera.distance).toFixed(3);
      for (const name of ['x','y','z','targetX','targetY','targetZ']) canvas.dataset['camera' + name[0].toUpperCase() + name.slice(1)] = Number(camera[name]).toFixed(3);
      canvas.dataset.cameraObstructed = String(camera.obstructed);
      canvas.dataset.renderCalls = String(scene.renderer?.info.render.calls || 0);
    }
    canvas.dataset.worldX = game.current.x.toFixed(3); canvas.dataset.worldY = game.current.y.toFixed(3);
    canvas.dataset.frames = String(renderedFrames);
    $('aim-reticle').hidden = !started || paused || !!game.player.vehicleId || !$('help-screen').hidden || graphicsFailed;
    if (aim.active) { $('aim-reticle').style.left = aim.x + 'px'; $('aim-reticle').style.top = aim.y + 'px'; }
    else { $('aim-reticle').style.left = '50%'; $('aim-reticle').style.top = '50%'; }
    $('speed-value').textContent = game.player.vehicleId ? Math.round(Math.abs(game.current.speed || 0) * 0.28) + ' KM/H' : 'ON FOOT';
    $('speed-caption').textContent = game.player.vehicleId ? 'SHIFT BOOST · SPACE DRIFT' : 'RIGHT DRAG LOOK · C RESET';
    const t = target();
    $('target-compass').hidden = !t;
    if (t) {
      const bearing = Math.atan2(t.y - game.current.y, t.x - game.current.x) - (scene?.viewYaw ?? game.current.angle);
      $('target-arrow').style.transform = 'rotate(' + Math.atan2(Math.sin(bearing), Math.cos(bearing)) * 180 / Math.PI + 'deg)';
      $('target-distance').textContent = Math.round(dist(t, game.current) / 20) + 'm';
    }
    $('cash').textContent = money(game.money); $('score').textContent = Math.round(game.score).toLocaleString(); $('best').textContent = Math.round(Math.max(game.bestScore || 0, game.score)).toLocaleString();
    $('heat').textContent = '★'.repeat(game.heat) + '☆'.repeat(3 - game.heat);
    $('heat').setAttribute('aria-label', `Heat ${game.heat} of 3`);
    $('heat').dataset.level = game.heat;
    $('composure-value').textContent = Math.round(game.player.composure) + '%';
    $('composure-bar').style.width = game.player.composure + '%';
    $('composure-meter')?.setAttribute('aria-valuenow', Math.round(game.player.composure));
    const car = game.player.vehicleId ? game.current : null;
    const condition = car ? clamp(car.health / game.maxHealth * 100, 0, 100) : 100;
    $('ride-name').textContent = car ? ({ compact: 'Lemon Buggy', sport: 'Disco Rocket', sports: 'Disco Rocket', van: 'Waffle Wagon' }[car.kind] || 'Borrowed ride') : 'Fresh sneakers';
    $('ride-bar').style.width = condition + '%';
    $('ride-meter')?.setAttribute('aria-valuenow', Math.round(condition));
    $('ride-condition').textContent = car ? Math.round(condition) + '%' : '—';
    const mission = game.mission;
    $('objective-title').textContent = mission?.title || 'Your town. Your terrible ideas.';
    const objective = target();
    $('objective-detail').textContent = mission ? (mission.type === 'party' ? 'Drive to the ring. Press H to start the party.' : mission.stage === 'pickup' ? 'Reach the glowing ring to pick up the disco ball.' : mission.stage === 'dropoff' ? 'Deliver that disco ball to the glowing ring.' : 'Drive through the glowing rings in order.') : 'Borrow a ride with E, then pick a gig from Dispatch.';
    $('mission-time').textContent = mission ? (mission.timeLeft > 0 ? Math.ceil(mission.timeLeft) + 's bonus' : 'OVERTIME · finish for base pay') : 'FREE ROAM';
    $('mission-progress').textContent = mission ? `${mission.targetIndex + 1}/${mission.targets.length} · ${Math.round(dist(objective, game.current) / 20)}m` : 'No rush. Cause a little joy.';
    $('mission-status').textContent = mission ? 'Gig in progress · base pay ' + money(mission.reward) : `${game.completed || 0} gigs delivered. Choose your next questionable errand.`;
    $('abandon-button').hidden = !mission;
    document.querySelectorAll('.contract-button').forEach(b => { b.disabled = !!mission; });
    const nearest = game.services.find(s => dist(s, game.current) < 115);
    $('garage-status').textContent = nearest ? (nearest.id === 'wash' ? 'At the wash · E repairs and clears heat.' : 'At the garage · tune-ups available.') : 'Visit GARAGE on the map for tune-ups. WASH clears heat.';
    $('boost-price').textContent = game.upgrades.boost >= 3 ? 'MAXED' : money(200 + game.upgrades.boost * 150);
    $('armor-price').textContent = game.upgrades.armor >= 3 ? 'MAXED' : money(150 + game.upgrades.armor * 125);
    const hint = nearest ? (nearest.id === 'wash' ? 'E · wash & cool off ($75)' : 'Garage · choose a tune-up on the right') : car ? (Math.abs(car.speed) < 45 ? 'E · hop out   H · honk   SPACE · drift' : 'SPACE · drift   SHIFT · boost   H · honk') : game.cars.some(c => dist(c, game.player) < 65) ? 'E · borrow this ride' : 'WASD · walk   SPACE · confetti popper';
    $('interaction-hint').textContent = hint;
    $('interaction-hint').hidden = !started;
    if (game.heat > 0) {
      const chase = game.policeSeen ? 'FUN POLICE · CHASED' : `LAY LOW · ${Math.max(0, Math.ceil((game.escapeGoal || 8 + game.heat * 6) - game.escapeTimer))}s TO COOL`;
      $('interaction-hint').textContent = chase + '  /  ' + hint;
    }
  }
  let last = performance.now(), accumulator = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.12); last = now;
    if (started && !paused && !graphicsFailed && $('help-screen').hidden && !document.hidden) {
      accumulator += dt;
      const input = { up: keys.has('KeyW') || keys.has('ArrowUp'), down: keys.has('KeyS') || keys.has('ArrowDown'), left: keys.has('KeyA') || keys.has('ArrowLeft'), right: keys.has('KeyD') || keys.has('ArrowRight'), boost: keys.has('ShiftLeft') || keys.has('ShiftRight'), brake: keys.has('Space') };
      if (!game.player.vehicleId) input.moveAngle = scene?.viewYaw ?? -Math.PI / 2;
      let count = 0;
      while (accumulator >= 1 / 60 && count++ < 8) { game.update(1 / 60, input); accumulator -= 1 / 60; }
      saveElapsed += dt;
      if (saveElapsed > 5) { save(); saveElapsed = 0; }
      events();
    } else accumulator = 0;
    render(dt);
    hudElapsed += dt;
    if (hudElapsed > 0.1) { hud(); hudElapsed = 0; }
    if (now > toastUntil) $('toast').classList.remove('visible');
    requestAnimationFrame(frame);
  }
  hud(); requestAnimationFrame(frame);
})();
