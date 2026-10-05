(() => {
  'use strict';
  const { Game, SIZE, ROAD_CENTERS, ROAD_WIDTH } = MayhemCore;
  const $ = id => document.getElementById(id);
  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');
  const game = new Game();
  const SAVE_KEY = 'mayhem-meadows.v1';
  const keys = new Set();
  let started = false, paused = false, helpWasPaused = false;
  let muted = false, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let audioContext, saveBlocked = false, toastUntil = 0, hudElapsed = 0, saveElapsed = 0;
  let width = 960, height = 650, zoom = 1;
  const camera = { x: game.current.x, y: game.current.y };
  const aim = { x: 0, y: 0, active: false };
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
    keys.clear();
    $('pause-screen').hidden = !paused;
    if (!paused) canvas.focus();
  }
  function start() {
    started = true; paused = false;
    $('start-screen').hidden = true;
    $('pause-screen').hidden = true;
    audioStart(); canvas.focus();
    toast('Press E to borrow the yellow car. Pick a gig on the right!');
    if (saveBlocked) toast('Saving is unavailable here. The full game still works this session.');
  }
  $('play-button').addEventListener('click', start);
  $('resume-button').addEventListener('click', () => { audioStart(); setPause(false); });
  $('restart-button').addEventListener('click', () => { game.recover(); setPause(false); events(); save(); });
  $('recover-button').addEventListener('click', () => { if (!started) start(); game.recover(); events(); canvas.focus(); });
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
  canvas.addEventListener('pointerdown', () => { canvas.focus(); audioStart(); });
  canvas.addEventListener('pointermove', event => {
    const r = canvas.getBoundingClientRect();
    aim.x = event.clientX - r.left; aim.y = event.clientY - r.top; aim.active = true;
  });
  canvas.addEventListener('pointerleave', () => { aim.active = false; });
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape' && !$('help-screen').hidden) { closeHelp(); return; }
    if (!started || !$('help-screen').hidden) return;
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault(); if (!event.repeat) setPause(!paused); return;
    }
    if (paused || document.activeElement !== canvas) return;
    const controlled = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space','KeyE','KeyH','KeyR'];
    if (!controlled.includes(event.code)) return;
    event.preventDefault(); keys.add(event.code);
    if (!event.repeat) {
      if (event.code === 'KeyE') game.interact();
      if (event.code === 'KeyH') game.horn();
      if (event.code === 'KeyR') game.recover();
      if (event.code === 'Space' && !game.player.vehicleId) {
        const angle = aim.active ? Math.atan2(camera.y + (aim.y - height / 2) / zoom - game.player.y, camera.x + (aim.x - width / 2) / zoom - game.player.x) : game.player.angle;
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

  const world = document.createElement('canvas');
  world.width = SIZE; world.height = SIZE;
  const map = world.getContext('2d');
  function rounded(c, x, y, w, h, r, fill, stroke) {
    c.beginPath(); c.roundRect(x, y, w, h, r);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.stroke(); }
  }
  function text(c, value, x, y, size = 12, color = '#fff', weight = 700, align = 'center') {
    c.font = `${weight} ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(value, x, y);
  }
  function tree(c, x, y, size = 17) {
    c.fillStyle = '#273b4438'; c.beginPath(); c.ellipse(x + 5, y + 7, size, size * 0.8, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3b806c'; c.beginPath(); c.arc(x, y, size, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#67b98d'; c.beginPath(); c.arc(x - 5, y - 5, size * 0.72, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#8ed0a0'; c.beginPath(); c.arc(x - 7, y - 8, size * 0.33, 0, Math.PI * 2); c.fill();
  }
  function buildMap() {
    map.fillStyle = '#83bba3'; map.fillRect(0, 0, SIZE, SIZE);
    for (let x = 30; x < SIZE; x += 60) for (let y = 20; y < SIZE; y += 60) {
      map.fillStyle = '#5c967429'; map.fillRect(x, y, 3, 5);
    }
    for (const road of ROAD_CENTERS) {
      map.fillStyle = '#d4d2ba'; map.fillRect(road - ROAD_WIDTH / 2 - 15, 0, ROAD_WIDTH + 30, SIZE); map.fillRect(0, road - ROAD_WIDTH / 2 - 15, SIZE, ROAD_WIDTH + 30);
      map.fillStyle = '#464d5a'; map.fillRect(road - ROAD_WIDTH / 2, 0, ROAD_WIDTH, SIZE); map.fillRect(0, road - ROAD_WIDTH / 2, SIZE, ROAD_WIDTH);
    }
    map.strokeStyle = '#e2d8a7'; map.lineWidth = 2; map.setLineDash([16, 24]);
    for (const road of ROAD_CENTERS) {
      map.beginPath(); map.moveTo(road, 0); map.lineTo(road, SIZE); map.stroke();
      map.beginPath(); map.moveTo(0, road); map.lineTo(SIZE, road); map.stroke();
    }
    map.setLineDash([]);
    for (const x of ROAD_CENTERS) for (const y of ROAD_CENTERS) {
      map.fillStyle = '#464d5a'; map.fillRect(x - 50, y - 50, 100, 100);
      map.fillStyle = '#dad9c2';
      for (let s = -32; s <= 32; s += 13) {
        map.fillRect(x + s, y + 55, 7, 14); map.fillRect(x + 55, y + s, 14, 7);
        map.fillRect(x + s, y - 69, 7, 14); map.fillRect(x - 69, y + s, 14, 7);
      }
    }
    rounded(map, 966, 966, 228, 228, 24, '#91ce91');
    map.strokeStyle = '#e9dfb8'; map.lineWidth = 30;
    map.beginPath(); map.moveTo(966,1080); map.lineTo(1194,1080); map.moveTo(1080,966); map.lineTo(1080,1194); map.stroke();
    rounded(map, 1055, 1055, 50, 50, 25, '#69b8c7', '#e4f7db');
    for (const [x,y] of [[1000,1000],[1160,1000],[1000,1160],[1160,1160]]) tree(map, x, y, 23);
    text(map, 'SPRINKLE PARK', 1080, 1035, 11, '#29554f');
    const roofColors = ['#cd8079','#8fa8c1','#d7b477','#9292b6','#7fae9d'];
    for (const [index, b] of game.buildings.entries()) {
      rounded(map, b.x + 8, b.y + 12, b.w, b.h, 10, '#17253345');
      rounded(map, b.x, b.y, b.w, b.h, 8, '#efe0bb', '#293c48');
      rounded(map, b.x + 7, b.y + 7, b.w - 14, b.h - 14, 5, roofColors[index % roofColors.length]);
      rounded(map, b.x + 17, b.y + 18, b.w - 34, b.h - 55, 3, '#ffffff19', '#27344233');
      for (let n = 0; n < 3; n++) {
        rounded(map, b.x + 28 + n * 45, b.y + 40, 28, 26, 3, '#eee7da');
        map.fillStyle = '#9ba5a0'; map.fillRect(b.x + 34 + n * 45, b.y + 44, 16, 18);
      }
      const names = ['FUDGE MART','DISCO DEPOT','WAFFLE WORKS','TINY TOWERS','SODA SOCIAL','HECK HOTEL','PIZZA PALACE','BISCUIT BANK'];
      rounded(map, b.x + 16, b.y + b.h - 40, b.w - 32, 25, 4, '#223345');
      text(map, b.name || names[index % names.length], b.x + b.w / 2, b.y + b.h - 27, 10, '#f4eac8');
      for (let t = 0; t < 2; t++) tree(map, b.x - 12, b.y + 55 + t * 110, 13);
    }
    for (const service of game.services) {
      const color = service.id === 'wash' ? '#70e6db' : '#e6f77c';
      rounded(map, service.x - 48, service.y - 44, 96, 88, 12, color + '66', color);
      text(map, service.id === 'wash' ? 'WASH' : 'GARAGE', service.x, service.y - 30, 11, '#182e3a');
    }
    text(map, 'MAYHEM MEADOWS', 1080, 75, 30, '#255c52');
    map.strokeStyle = '#385e60'; map.lineWidth = 12; map.strokeRect(6, 6, SIZE - 12, SIZE - 12);
  }
  buildMap();
  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    zoom = clamp(width / 1050, 0.65, 1.1);
  }
  new ResizeObserver(resize).observe(canvas); resize();

  function drawCar(car, patrol = false) {
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.angle);
    const van = car.kind === 'van'; const length = van ? 53 : 43, half = length / 2;
    rounded(ctx, -half + 3, -11 + 5, length, 27, 6, '#101c2b50');
    for (const x of [-half + 6, half - 12]) for (const y of [-15, 10]) rounded(ctx, x, y, 9, 5, 1, '#14212e');
    rounded(ctx, -half, -12, length, 24, 5, patrol ? '#f4eee1' : (car.color || '#f4ca65'), '#253346');
    if (patrol) rounded(ctx, -10, -11, 19, 22, 2, '#233f57');
    rounded(ctx, -7, -10, 17, 20, 3, '#dbe8d0');
    rounded(ctx, 4, -8, 7, 16, 2, '#264f65');
    rounded(ctx, -13, -8, 5, 16, 1, '#315b68');
    if (van) rounded(ctx, -half + 3, -9, 12, 18, 2, car.color || '#ab98da');
    ctx.fillStyle = '#fff6bd'; ctx.fillRect(half - 3, -9, 3, 5); ctx.fillRect(half - 3, 4, 3, 5);
    ctx.fillStyle = '#e46470'; ctx.fillRect(-half, -9, 2, 5); ctx.fillRect(-half, 4, 2, 5);
    if (patrol) {
      const blink = reducedMotion || Math.floor(game.time * 4) % 2 === 0;
      rounded(ctx, -2, -10, 5, 10, 1, blink ? '#ff767e' : '#aa586a');
      rounded(ctx, -2, 0, 5, 10, 1, blink ? '#4b81ae' : '#65c9ff');
    }
    if (car.id === game.player.vehicleId) {
      ctx.strokeStyle = '#eafa86'; ctx.lineWidth = 2; ctx.strokeRect(-half - 4, -17, length + 8, 34);
    }
    ctx.restore();
  }
  function drawPerson(person, player = false) {
    ctx.save(); ctx.translate(person.x, person.y); ctx.rotate(person.angle || 0);
    ctx.globalAlpha = person.stunned > 0 ? 0.55 : 1;
    rounded(ctx, -7, -7, 14, 14, 5, player ? '#f4efbf' : (person.color || '#ea9595'), '#293d4a');
    ctx.fillStyle = player ? '#6de4cc' : '#efd4a9'; ctx.beginPath(); ctx.arc(2, 0, 5, 0, Math.PI * 2); ctx.fill();
    if (player) { rounded(ctx, -8, -5, 4, 10, 1, '#dd8175'); rounded(ctx, 7, -6, 9, 4, 1, '#f4bd5a'); }
    ctx.restore();
    if (player) {
      ctx.strokeStyle = '#ecfa8b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(person.x, person.y, 15, 0, Math.PI * 2); ctx.stroke();
    }
    if (person.bubble && person.bubbleTimer > 0) {
      const w = person.bubble.length * 6 + 18;
      rounded(ctx, person.x - w / 2, person.y - 39, w, 22, 5, '#fff0cb', '#263f50');
      text(ctx, person.bubble, person.x, person.y - 28, 10, '#25384b');
    }
  }
  function target() { return game.mission?.targets?.[game.mission.targetIndex]; }
  function renderTarget() {
    const point = target(); if (!point) return;
    const pulse = reducedMotion ? 1 : 1 + Math.sin(game.time * 3) * 0.09;
    ctx.strokeStyle = '#efff89'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(point.x, point.y, 42 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#dcf77935'; ctx.beginPath(); ctx.arc(point.x, point.y, 37, 0, Math.PI * 2); ctx.fill();
    text(ctx, game.mission.type === 'party' ? 'HONK!' : String(game.mission.targetIndex + 1), point.x, point.y, 15, '#fbffac');
    const sx = (point.x - camera.x) * zoom + width / 2, sy = (point.y - camera.y) * zoom + height / 2;
    if (sx > 55 && sx < width - 55 && sy > 90 && sy < height - 90) return;
    ctx.save(); ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    const angle = Math.atan2(sy - height / 2, sx - width / 2);
    const edge = Math.min((width / 2 - 48) / Math.max(0.001, Math.abs(Math.cos(angle))), (height / 2 - 100) / Math.max(0.001, Math.abs(Math.sin(angle))));
    const ax = width / 2 + Math.cos(angle) * edge, ay = height / 2 + Math.sin(angle) * edge;
    ctx.translate(ax, ay); ctx.rotate(angle);
    ctx.fillStyle = '#ebfb85'; ctx.beginPath(); ctx.moveTo(17, 0); ctx.lineTo(-8, -11); ctx.lineTo(-3, 0); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
    ctx.rotate(-angle); text(ctx, Math.round(dist(point, game.current)) + 'm', 0, 26, 11, '#f7f7d8'); ctx.restore();
  }
  function minimap() {
    const size = Math.min(145, width * 0.23), x = width - size - 18, y = height - size - (width < 600 ? 108 : 23), s = size / SIZE;
    rounded(ctx, x - 6, y - 23, size + 12, size + 29, 8, '#182b3cef', '#b6cab055');
    text(ctx, 'THE NEIGHBORHOOD', x + 4, y - 12, 9, '#d3ddc3', 600, 'left');
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#608d76'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#3b4655';
    for (const road of ROAD_CENTERS) { ctx.fillRect((road - 50) * s, 0, 100 * s, size); ctx.fillRect(0, (road - 50) * s, size, 100 * s); }
    for (const service of game.services) {
      ctx.fillStyle = service.id === 'wash' ? '#70e6db' : '#e6f77c'; ctx.fillRect(service.x * s - 2, service.y * s - 2, 4, 4);
    }
    const t = target();
    if (t) { ctx.strokeStyle = '#effa88'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(t.x * s, t.y * s, 5, 0, Math.PI * 2); ctx.stroke(); }
    for (const police of game.police) { ctx.fillStyle = '#ff8294'; ctx.beginPath(); ctx.arc(police.x * s, police.y * s, 2.3, 0, Math.PI * 2); ctx.fill(); }
    ctx.translate(game.current.x * s, game.current.y * s); ctx.rotate(game.current.angle);
    ctx.fillStyle = '#fff8d9'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-3, 0); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  function render(dt) {
    const current = game.current;
    const look = game.player.vehicleId ? Math.min(Math.abs(current.speed || 0) * 0.17, 50) : 0;
    const targetX = current.x + Math.cos(current.angle) * look, targetY = current.y + Math.sin(current.angle) * look;
    const follow = reducedMotion ? 1 : 1 - Math.exp(-dt * 8);
    camera.x += (targetX - camera.x) * follow; camera.y += (targetY - camera.y) * follow;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#75a88f'; ctx.fillRect(0, 0, width, height);
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.scale(zoom, zoom); ctx.translate(-camera.x, -camera.y);
    ctx.drawImage(world, 0, 0);
    for (const mark of game.skidMarks || []) {
      ctx.save(); ctx.globalAlpha = clamp(mark.life / 6, 0, 0.35); ctx.translate(mark.x, mark.y); ctx.rotate(mark.angle);
      ctx.fillStyle = '#1c253a'; ctx.fillRect(-6, -12, 12, 3); ctx.fillRect(-6, 9, 12, 3); ctx.restore();
    }
    for (const car of game.cars) drawCar(car);
    for (const patrol of game.police) drawCar(patrol, true);
    for (const ped of game.peds) drawPerson(ped);
    if (!game.player.vehicleId) drawPerson(game.player, true);
    const particleLimit = reducedMotion ? 35 : 350;
    for (const p of game.particles.slice(-particleLimit)) {
      ctx.globalAlpha = clamp(p.life / (p.maxLife || 1), 0, 1); ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size || 4, (p.size || 4) * 0.5);
    }
    ctx.globalAlpha = 1; renderTarget(); ctx.restore();
    minimap();
    if (width >= 600) {
      rounded(ctx, 18, height - 127, 121, 48, 8, '#182b3cee', '#b6cab055');
      text(ctx, game.player.vehicleId ? Math.round(Math.abs(current.speed || 0) * 0.28) + ' KM/H' : 'ON FOOT', 31, height - 105, 17, '#ecfa8b', 800, 'left');
      text(ctx, game.player.vehicleId ? 'SHIFT = BOOST' : 'SHIFT = SPRINT', 31, height - 88, 9, '#c2d3ca', 500, 'left');
    }
  }
  function hud() {
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
    $('mission-progress').textContent = mission ? `${mission.targetIndex + 1}/${mission.targets.length} · ${Math.round(dist(objective, game.current))}m` : 'No rush. Cause a little joy.';
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
    if (started && !paused && $('help-screen').hidden && !document.hidden) {
      accumulator += dt;
      const input = { up: keys.has('KeyW') || keys.has('ArrowUp'), down: keys.has('KeyS') || keys.has('ArrowDown'), left: keys.has('KeyA') || keys.has('ArrowLeft'), right: keys.has('KeyD') || keys.has('ArrowRight'), boost: keys.has('ShiftLeft') || keys.has('ShiftRight'), brake: keys.has('Space') };
      let count = 0;
      while (accumulator >= 1 / 60 && count++ < 8) { game.update(1 / 60, input); accumulator -= 1 / 60; }
      saveElapsed += dt;
      if (saveElapsed > 5) { save(); saveElapsed = 0; }
      events();
    } else accumulator = 0;
    hudElapsed += dt;
    if (hudElapsed > 0.1) { hud(); hudElapsed = 0; }
    render(dt);
    if (now > toastUntil) $('toast').classList.remove('visible');
    requestAnimationFrame(frame);
  }
  hud(); requestAnimationFrame(frame);
})();
