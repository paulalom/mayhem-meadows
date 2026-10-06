(() => {
  'use strict';
  const { Game, SIZE, ROAD_CENTERS, ROAD_WIDTH, CAR_TYPES, GADGETS, POCKET_ITEMS, PAINT_COLORS } = MayhemCore;
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
  let dragging = false, dragX = 0, dragY = 0, dragPointerId = null;
  let wheelOpen = false, wheelIndex = 0, inventoryView = null, garageSignature = '';
  const toyIds = ['popper', 'hammer', 'cannon'];
  const money = n => '$' + Math.round(n).toLocaleString();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const inventoryBusy = () => wheelOpen || inventoryView !== null;

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
    const tones = { horn: [180, 0.18, 'sawtooth'], confetti: [650, 0.1, 'triangle'], flop: [260, 0.22, 'triangle'], crash: [75, 0.13, 'square'], pickup: [660, 0.14, 'sine'], complete: [880, 0.32, 'triangle'], bust: [120, 0.32, 'sawtooth'], upgrade: [1040, 0.2, 'sine'] };
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
  function toyDetail(id) {
    if (!game.inventory.unlocked.includes(id)) return 'LOCKED · ' + money(GADGETS[id].price);
    return id === 'cannon' ? game.inventory.ammo.cannon + ' / 12 charges' : 'Unlimited nonsense';
  }
  function renderWheel() {
    document.querySelectorAll('.wheel-option').forEach(button => {
      const id = button.dataset.gadget, selected = toyIds[wheelIndex] === id;
      button.disabled = !game.inventory.unlocked.includes(id);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.querySelector('.toy-name').textContent = GADGETS[id].name;
      button.querySelector('.toy-detail').textContent = GADGETS[id].description;
      button.querySelector('.toy-ammo').textContent = toyDetail(id);
    });
    $('wheel-selected').textContent = GADGETS[toyIds[wheelIndex]].name + ' · release Tab to equip';
    if (wheelOpen) document.querySelector('.wheel-option[data-gadget="' + toyIds[wheelIndex] + '"]').focus({ preventScroll: true });
  }
  function openWheel() {
    if (!started || paused || graphicsFailed || !$('help-screen').hidden || inventoryView) return;
    if (game.physics?.get('player')) { toast('Find your feet before changing toys. R skips the drama.'); return; }
    wheelOpen = true; keys.clear(); stopDrag();
    wheelIndex = toyIds.indexOf(game.inventory.equipped);
    $('toy-wheel').hidden = false; renderWheel();
  }
  function closeWheel(equip = false, focus = true) {
    if (!wheelOpen) return;
    if (equip) { game.equipGadget(toyIds[wheelIndex]); events(); save(); }
    wheelOpen = false; $('toy-wheel').hidden = true; keys.clear();
    if (focus && started && !paused) canvas.focus({ preventScroll: true });
  }
  function cycleWheel(direction) {
    for (let i = 0; i < toyIds.length; i++) {
      wheelIndex = (wheelIndex + direction + toyIds.length) % toyIds.length;
      if (game.inventory.unlocked.includes(toyIds[wheelIndex])) break;
    }
    renderWheel();
  }
  function closeInventory(focus = true) {
    inventoryView = null; $('inventory-screen').hidden = true; keys.clear();
    if (focus && started && !paused) canvas.focus({ preventScroll: true });
  }
  function openInventory(view) {
    if (!started) start();
    if (paused || graphicsFailed || !$('help-screen').hidden || !started) return;
    closeWheel(false, false); keys.clear(); stopDrag();
    if (inventoryView !== view) $('inventory-screen').querySelector('.inventory-scroll').scrollTop = 0;
    inventoryView = view; $('inventory-screen').hidden = false;
    $('pockets-panel').hidden = view !== 'pockets';
    $('collection-panel').hidden = view !== 'garage';
    $('pockets-tab').setAttribute('aria-selected', String(view === 'pockets'));
    $('collection-tab').setAttribute('aria-selected', String(view === 'garage'));
    $('pockets-tab').tabIndex = view === 'pockets' ? 0 : -1;
    $('collection-tab').tabIndex = view === 'garage' ? 0 : -1;
    $('inventory-title').textContent = view === 'pockets' ? 'Pockets full of possibilities.' : 'Your questionable collection.';
    renderInventory();
    $(view === 'pockets' ? 'pockets-tab' : 'collection-tab').focus({ preventScroll: true });
  }
  function renderGarage() {
    const records = game.garage.cars.map(record => ({ ...record, health: game.cars.find(car => car.garageId === record.id)?.health ?? record.health }));
    $('garage-count').textContent = records.length + ' / 3 rides';
    $('garage-empty').hidden = records.length !== 0;
    const currentSaved = records.some(record => record.id === game.current.garageId);
    $('store-car').disabled = !game.garageAvailable || !game.player.vehicleId || currentSaved || records.length >= 3;
    $('store-car').textContent = currentSaved ? 'Ride already saved' : records.length >= 3 ? 'Garage full · release a slot' : 'Save current ride';
    const signature = JSON.stringify([records, game.garageAvailable, game.money, game.maxHealth]);
    if (signature === garageSignature) return;
    const previous = document.activeElement;
    const focusId = previous?.dataset.retrieveCar || previous?.dataset.paintCar || previous?.dataset.repairCar || previous?.dataset.releaseCar;
    const focusColor = previous?.dataset.color;
    garageSignature = signature;
    const fragment = document.createDocumentFragment();
    for (const record of records) {
      const card = document.createElement('article'); card.className = 'saved-car'; card.dataset.garageId = record.id;
      const heading = document.createElement('div'); heading.className = 'saved-car-heading';
      const copy = document.createElement('div');
      const name = document.createElement('h3'); name.className = 'saved-car-name'; name.textContent = CAR_TYPES[record.kind].name;
      const condition = document.createElement('p'); condition.className = 'saved-car-condition'; condition.textContent = Math.round(record.health / game.maxHealth * 100) + '% condition · shared tune-ups';
      copy.append(name, condition); heading.append(copy);
      const badge = document.createElement('span'); badge.className = 'saved-car-badge'; badge.style.background = record.color; badge.setAttribute('aria-label', 'Current paint ' + record.color); heading.append(badge);
      const actions = document.createElement('div'); actions.className = 'saved-car-actions';
      const retrieve = document.createElement('button'); retrieve.type = 'button'; retrieve.className = 'inventory-action'; retrieve.dataset.retrieveCar = record.id; retrieve.textContent = record.health <= 0 ? 'Needs repair first' : 'Bring it out ↗'; retrieve.disabled = !game.garageAvailable || record.health <= 0; actions.append(retrieve);
      const repair = document.createElement('button'); repair.type = 'button'; repair.className = 'inventory-action'; repair.dataset.repairCar = record.id; repair.textContent = 'Un-dent · $45'; repair.disabled = !game.garageAvailable || record.health >= game.maxHealth || game.money < 45; actions.append(repair);
      const release = document.createElement('button'); release.type = 'button'; release.className = 'inventory-action'; release.dataset.releaseCar = record.id; release.textContent = 'Release slot'; release.title = 'Remove ownership; any deployed car stays in town'; release.disabled = !game.garageAvailable; actions.append(release);
      const swatches = document.createElement('div'); swatches.className = 'garage-swatches'; swatches.setAttribute('aria-label', 'Paint choices · $25 each');
      for (const color of PAINT_COLORS) {
        const paint = document.createElement('button'); paint.type = 'button'; paint.className = 'paint-swatch'; paint.style.setProperty('--paint', color);
        paint.dataset.paintCar = record.id; paint.dataset.color = color;
        paint.title = color === record.color ? 'Current paint' : 'Paint ' + color + ' · $25';
        paint.setAttribute('aria-label', paint.title); paint.setAttribute('aria-pressed', String(color === record.color));
        paint.disabled = !game.garageAvailable || game.money < 25 || color === record.color;
        swatches.append(paint);
      }
      actions.append(swatches); card.append(heading, actions); fragment.append(card);
    }
    $('garage-cars').replaceChildren(fragment);
    if (focusId) {
      const replacement = [...$('garage-cars').querySelectorAll('button')].find(button => (button.dataset.retrieveCar || button.dataset.paintCar || button.dataset.repairCar || button.dataset.releaseCar) === focusId && button.dataset.color === focusColor && !button.disabled);
      (replacement || $('collection-tab')).focus({ preventScroll: true });
    }
  }
  function renderInventory() {
    if (!inventoryView) return;
    const available = game.garageAvailable, fallen = !!game.physics?.get('player');
    $('inventory-location').textContent = available ? 'At Sprinkle Garage · supplies, toys and car care are open.' : 'Browse anywhere. Visit Sprinkle Garage and stop to shop or manage rides.';
    $('inventory-location').dataset.available = String(available);
    $('inventory-location').classList.toggle('available', available);
    for (const id of Object.keys(POCKET_ITEMS)) {
      const definition = POCKET_ITEMS[id], count = game.inventory.pockets[id];
      const card = document.querySelector('[data-pocket="' + id + '"]');
      card.querySelector('.pocket-count').textContent = count + ' / ' + definition.cap;
      card.querySelector('.pocket-description').textContent = definition.description;
      const use = card.querySelector('[data-use-pocket]'), buy = card.querySelector('[data-buy-pocket]');
      const needed = id === 'biscuits' ? game.player.composure < 100 : id === 'repairTape' ? !!game.player.vehicleId && Math.abs(game.current.speed || 0) <= 45 && game.current.health < game.maxHealth : game.inventory.unlocked.includes('cannon') && game.inventory.ammo.cannon < 12;
      use.disabled = fallen || count <= 0 || !needed;
      use.textContent = id === 'refill' ? 'Load cannon' : 'Use one';
      buy.disabled = !available || count >= definition.cap || game.money < definition.price;
      buy.textContent = 'Buy · ' + money(definition.price);
    }
    document.querySelectorAll('[data-shop-gadget]').forEach(card => {
      const id = card.dataset.shopGadget, owned = game.inventory.unlocked.includes(id), button = card.querySelector('[data-buy-gadget]');
      card.querySelector('.gadget-status').textContent = owned ? 'In your toy wheel' : GADGETS[id].description;
      card.querySelector('.gadget-price').textContent = owned ? 'UNLOCKED' : money(GADGETS[id].price);
      button.firstChild.nodeValue = owned ? 'Yours forever ' : 'Unlock toy ';
      button.disabled = owned || !available || game.money < GADGETS[id].price;
    });
    renderGarage();
  }
  function inventoryAction(action) {
    action(); events(); save(); renderInventory(); hud();
  }
  $('inventory-toggle').addEventListener('click', () => openInventory('pockets'));
  $('garage-toggle').addEventListener('click', () => openInventory('garage'));
  $('close-inventory').addEventListener('click', () => closeInventory());
  $('pockets-tab').addEventListener('click', () => openInventory('pockets'));
  $('collection-tab').addEventListener('click', () => openInventory('garage'));
  $('store-car').addEventListener('click', () => inventoryAction(() => game.garageStore()));
  $('inventory-screen').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.usePocket) inventoryAction(() => game.usePocket(button.dataset.usePocket));
    if (button.dataset.buyPocket) inventoryAction(() => game.purchasePocket(button.dataset.buyPocket));
    if (button.dataset.buyGadget) inventoryAction(() => game.purchaseGadget(button.dataset.buyGadget));
    if (button.dataset.retrieveCar) inventoryAction(() => { if (game.garageRetrieve(button.dataset.retrieveCar)) { closeInventory(); scene?.recenter(); } });
    if (button.dataset.paintCar) inventoryAction(() => game.garagePaint(button.dataset.paintCar, button.dataset.color));
    if (button.dataset.repairCar) inventoryAction(() => game.garageRepair(button.dataset.repairCar));
    if (button.dataset.releaseCar) inventoryAction(() => game.garageRelease(button.dataset.releaseCar));
  });
  document.querySelectorAll('.wheel-option').forEach(button => {
    button.addEventListener('pointerenter', () => { if (wheelOpen && !button.disabled) { wheelIndex = toyIds.indexOf(button.dataset.gadget); renderWheel(); } });
    button.addEventListener('click', () => { if (wheelOpen && !button.disabled) { wheelIndex = toyIds.indexOf(button.dataset.gadget); closeWheel(true); } });
  });
  $('toy-wheel').addEventListener('wheel', event => { if (wheelOpen) { event.preventDefault(); cycleWheel(event.deltaY >= 0 ? 1 : -1); } }, { passive: false });
  function setPause(value) {
    if (!started) return;
    closeWheel(false, false); closeInventory(false);
    paused = value;
    keys.clear(); stopDrag();
    $('pause-screen').hidden = !paused;
    if (!paused) canvas.focus();
  }
  function start() {
    if (!scene || graphicsFailed) { graphicsError('This browser could not start 3D. Use a WebGL 2 capable browser with hardware acceleration enabled.'); return; }
    started = true; paused = false;
    $('start-screen').hidden = true;
    $('pause-screen').hidden = true;
    audioStart(); canvas.focus();
    toast('E borrows a ride. Hold Tab for toys; I opens your pockets.');
    if (saveBlocked) toast('Saving is unavailable here. The full game still works this session.');
  }
  $('play-button').addEventListener('click', start);
  $('reload-button').addEventListener('click', () => location.reload());
  $('fullscreen-toggle').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector('.app').requestFullscreen();
      if (started && !paused && !inventoryBusy()) canvas.focus({ preventScroll: true });
    } catch (_) { toast('Full screen is unavailable in this browser.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen-toggle').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    $('fullscreen-toggle').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  });
  $('resume-button').addEventListener('click', () => { audioStart(); setPause(false); });
  $('restart-button').addEventListener('click', () => { game.recover(); setPause(false); events(); save(); });
  $('recover-button').addEventListener('click', () => { if (!started) start(); if (graphicsFailed) return; closeWheel(false, false); closeInventory(false); game.recover(); events(); canvas.focus(); });
  $('sound-toggle').addEventListener('click', () => { muted = !muted; audioStart(); settingsUI(); save(); if (started && !paused && !inventoryBusy() && $('help-screen').hidden) canvas.focus(); });
  $('motion-toggle').addEventListener('click', () => { reducedMotion = !reducedMotion; settingsUI(); save(); if (started && !paused && !inventoryBusy() && $('help-screen').hidden) canvas.focus(); });
  $('help-toggle').addEventListener('click', () => {
    closeWheel(false, false); closeInventory(false);
    helpWasPaused = paused;
    if (started) { paused = true; keys.clear(); stopDrag(); }
    $('help-screen').hidden = false; $('close-help').focus();
  });
  function closeHelp() {
    $('help-screen').hidden = true;
    if (started) setPause(helpWasPaused);
  }
  $('close-help').addEventListener('click', closeHelp);
  document.querySelectorAll('.contract-button').forEach(button => button.addEventListener('click', () => {
    if (!started) start();
    if (paused || inventoryBusy() || !$('help-screen').hidden) { toast('Resume the game to accept a gig.'); return; }
    game.acceptMission(button.dataset.mission); events(); canvas.focus();
  }));
  document.querySelectorAll('.purchase-button').forEach(button => button.addEventListener('click', () => {
    if (!started || paused || inventoryBusy() || !$('help-screen').hidden) { toast('Visit a garage while playing to buy a tune-up.'); return; }
    game.purchase(button.dataset.upgrade); events(); save(); canvas.focus();
  }));
  $('abandon-button').addEventListener('click', () => { if (!paused && !inventoryBusy() && started) { game.abandonMission(); events(); canvas.focus(); } });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (!started || paused || inventoryBusy() || !$('help-screen').hidden || graphicsFailed) return;
    canvas.focus({ preventScroll: true }); audioStart();
    if (event.button === 2) {
      dragging = true; dragX = event.clientX; dragY = event.clientY; dragPointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId); event.preventDefault();
    }
  });
  canvas.addEventListener('pointermove', event => {
    const r = canvas.getBoundingClientRect();
    aim.x = event.clientX - r.left; aim.y = event.clientY - r.top; aim.active = true;
    if (dragging && started && !paused && !inventoryBusy() && $('help-screen').hidden) {
      scene?.orbit(event.clientX - dragX, event.clientY - dragY);
      dragX = event.clientX; dragY = event.clientY;
    }
  });
  function stopDrag(event) {
    dragging = false;
    const pointerId = event?.pointerId ?? dragPointerId;
    if (pointerId !== null && pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    dragPointerId = null;
  }
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('lostpointercapture', () => { dragging = false; dragPointerId = null; });
  canvas.addEventListener('pointerleave', () => { if (!dragging) aim.active = false; });
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code === 'Escape' && !$('help-screen').hidden) { event.preventDefault(); closeHelp(); return; }
    if (!started || !$('help-screen').hidden) return;
    if (wheelOpen) {
      event.preventDefault();
      if (event.code === 'Escape') closeWheel(false);
      else if (!event.repeat && ['ArrowRight', 'ArrowDown'].includes(event.code)) cycleWheel(1);
      else if (!event.repeat && ['ArrowLeft', 'ArrowUp'].includes(event.code)) cycleWheel(-1);
      else if (!event.repeat && /^Digit[123]$/.test(event.code)) {
        const index = Number(event.code.slice(-1)) - 1;
        if (game.inventory.unlocked.includes(toyIds[index])) { wheelIndex = index; renderWheel(); }
      }
      return;
    }
    if (inventoryView) {
      if (document.activeElement?.getAttribute('role') === 'tab' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) openInventory(event.code === 'Home' ? 'pockets' : event.code === 'End' ? 'garage' : inventoryView === 'pockets' ? 'garage' : 'pockets');
      } else if (event.code === 'Escape' || event.code === 'KeyI' || event.code === 'KeyG') {
        event.preventDefault();
        if (!event.repeat) {
          const requested = event.code === 'KeyI' ? 'pockets' : event.code === 'KeyG' ? 'garage' : null;
          if (!requested || requested === inventoryView) closeInventory(); else openInventory(requested);
        }
      } else if (event.code === 'Tab') {
        const focusable = [...$('inventory-screen').querySelectorAll('button:not([disabled])')].filter(button => button.tabIndex >= 0 && button.getClientRects().length);
        const index = focusable.indexOf(document.activeElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
        else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) { event.preventDefault(); focusable[0]?.focus(); }
      }
      return;
    }
    if (event.code === 'Escape' || event.code === 'KeyP') {
      event.preventDefault(); if (!event.repeat) setPause(!paused); return;
    }
    if (paused || graphicsFailed || document.activeElement !== canvas) return;
    if (event.code === 'Tab') { event.preventDefault(); if (!event.repeat) openWheel(); return; }
    if (event.code === 'KeyI' || event.code === 'KeyG') { event.preventDefault(); if (!event.repeat) openInventory(event.code === 'KeyI' ? 'pockets' : 'garage'); return; }
    const controlled = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space','KeyE','KeyH','KeyR','KeyC','KeyF'];
    if (!controlled.includes(event.code)) return;
    event.preventDefault(); keys.add(event.code);
    if (!event.repeat) {
      if (event.code === 'KeyE') game.interact();
      if (event.code === 'KeyH') game.horn();
      if (event.code === 'KeyR') { game.recover(); scene?.recenter(); }
      if (event.code === 'KeyC') scene?.recenter();
      if (event.code === 'KeyF') { if (game.flop()) keys.clear(); }
      if (event.code === 'Space' && !game.player.vehicleId) {
        const angle = aim.active && scene ? scene.aimAngle(aim.x, aim.y, width, height) : scene?.viewYaw ?? game.player.angle;
        game.action(angle);
      }
      events();
    }
  });
  window.addEventListener('keyup', event => { keys.delete(event.code); if (event.code === 'Tab' && wheelOpen) { event.preventDefault(); closeWheel(true); } });
  window.addEventListener('blur', () => { keys.clear(); if (started) setPause(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && started) { setPause(true); save(); } });
  window.addEventListener('beforeunload', save);
  settingsUI();

  function graphicsError(message) {
    closeWheel(false, false); closeInventory(false);
    graphicsFailed = true; paused = true; keys.clear(); stopDrag();
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
    if (scene && !graphicsFailed) { scene.update(dt, { reducedMotion, paused: paused || inventoryBusy() || !started }); renderedFrames++; }
  }
  function hud() {
    drawMinimap();
    $('equipped-toy').textContent = GADGETS[game.inventory.equipped].name + (game.inventory.equipped === 'cannon' ? ' · ' + game.inventory.ammo.cannon + ' charges' : '') + ' · TAB';
    canvas.dataset.equippedToy = game.inventory.equipped;
    canvas.dataset.inventoryMode = wheelOpen ? 'wheel' : inventoryView || 'none';
    renderInventory();
    const fallen = game.physics?.get('player');
    canvas.dataset.ragdollCount = String(game.physics?.bodies.size || 0);
    canvas.dataset.playerRagdoll = fallen?.phase || 'none';
    canvas.dataset.playerRagdollAge = Number(fallen?.age || 0).toFixed(4);
    canvas.dataset.renderedRagdolls = String(scene?.ragdollCount || 0);
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
    $('aim-reticle').hidden = !started || paused || inventoryBusy() || !!game.player.vehicleId || !!fallen || !$('help-screen').hidden || graphicsFailed;
    if (aim.active) { $('aim-reticle').style.left = aim.x + 'px'; $('aim-reticle').style.top = aim.y + 'px'; }
    else { $('aim-reticle').style.left = '50%'; $('aim-reticle').style.top = '50%'; }
    $('speed-value').textContent = game.player.vehicleId ? Math.round(Math.abs(game.current.speed || 0) * 0.28) + ' KM/H' : fallen ? (fallen.phase === 'recover' ? 'GETTING UP' : 'WHOOPS!') : 'ON FOOT';
    $('speed-caption').textContent = game.player.vehicleId ? 'SHIFT BOOST · SPACE DRIFT' : fallen ? 'R · SKIP THE DRAMA' : 'F · DRAMATIC FLOP';
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
    $('ride-name').textContent = car ? (CAR_TYPES[car.kind]?.name || 'Borrowed ride') : 'Fresh sneakers';
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
    $('garage-status').textContent = nearest ? (nearest.id === 'wash' ? 'At the wash · E repairs and clears heat.' : 'At the garage · G saves rides. I buys supplies.') : 'Visit GARAGE for rides, toys and supplies. WASH clears heat.';
    $('boost-price').textContent = game.upgrades.boost >= 3 ? 'MAXED' : money(200 + game.upgrades.boost * 150);
    $('armor-price').textContent = game.upgrades.armor >= 3 ? 'MAXED' : money(150 + game.upgrades.armor * 125);
    const hint = nearest ? (nearest.id === 'wash' ? 'E · wash & cool off ($75)' : 'G · garage collection   I · supplies & toys') : car ? (Math.abs(car.speed) < 45 ? 'E · hop out   H · honk   SPACE · drift' : 'SPACE · drift   SHIFT · boost   H · honk') : game.cars.some(c => dist(c, game.player) < 65) ? 'E · borrow this ride' : 'SPACE · ' + GADGETS[game.inventory.equipped].name + '   TAB · toys   I · pockets';
    $('interaction-hint').textContent = hint;
    if (fallen) $('interaction-hint').textContent = fallen.phase === 'recover' ? 'Just finding my feet…  R · recover now' : 'Oh, crumbs! Getting up shortly…  R · recover now';
    $('interaction-hint').hidden = !started;
    if (game.heat > 0 && !fallen) {
      const chase = game.policeSeen ? 'FUN POLICE · CHASED' : `LAY LOW · ${Math.max(0, Math.ceil((game.escapeGoal || 8 + game.heat * 6) - game.escapeTimer))}s TO COOL`;
      $('interaction-hint').textContent = chase + '  /  ' + hint;
    }
  }
  let last = performance.now(), accumulator = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.12); last = now;
    if (started && !paused && !inventoryBusy() && !graphicsFailed && $('help-screen').hidden && !document.hidden) {
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
