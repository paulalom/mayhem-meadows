(() => {
  'use strict';
  const { Game, SIZE, MAX_HEAT, VehicleStats, GADGETS, POCKET_ITEMS, PAINT_COLORS, DISTRICTS } = MayhemCore;
  const $ = id => document.getElementById(id);
  const canvas = $('game-canvas');
  const game = new Game();
  const { AudioDirector, STATIONS, normalizeSettings } = MayhemAudio;
  const SAVE_KEY = 'mayhem-meadows.v1';
  const keys = new Set();
  const controls = MayhemControls;
  let controlSettings = controls.normalizeSettings();
  let settingsOpen = false, settingsWasPaused = false, settingsReturnFocus = null, bindingCapture = null;
  let controlGroup = 'plane';
  const activeControlGroup = () => game.player.vehicleId ? (isHelicopter(game.current) ? 'helicopter' : controls.groupFor(game.current)) : 'foot';
  const controlKey = (id, group = activeControlGroup()) => controls.keyLabel(controlSettings[group].bindings[id]?.[0] || '');
  let started = false, paused = false, helpWasPaused = false;
  let muted = false, reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let audioSettings = normalizeSettings(), saveBlocked = false, toastUntil = 0, hudElapsed = 0, saveElapsed = 0;
  let width = 960, height = 650, scene = null, renderedFrames = 0, graphicsFailed = false;
  let cameraSensitivity = 1, cameraInvertY = false, aiming = false, firing = false, altFiring = false;
  let mouseLockPending = false, intentionalUnlock = false;
  let mapOpen = false, wheelOpen = false, wheelIndex = 0, inventoryView = null, garageSignature = '', hangarSignature = '', navigationTarget = null;
  const toyIds = ['popper', 'hammer', 'cannon'];
  const money = n => '$' + Math.round(n).toLocaleString();
  const garageHint = 'Visit Sprinkle Garage and stop to shop or manage rides.';
  const hangarHint = 'Land and stop at an airfield apron or helipad to manage aircraft.';
  const cashHint = price => 'You need ' + money(price) + ' (' + money(price - game.money) + ' more).';
  function buttonState(button, reason = '', hint = '') {
    button.disabled = Boolean(reason);
    button.title = reason || hint;
  }
  const isAircraft = vehicle => vehicle?.kind === 'aircraft';
  const isTank = vehicle => vehicle?.kind === 'tank';
  const aircraftModel = vehicle => MayhemAircraft.getModel(vehicle);
  const isHelicopter = vehicle => isAircraft(vehicle) && aircraftModel(vehicle).class === 'helicopter';
  const vehicleName = vehicle => { const model = isAircraft(vehicle) ? aircraftModel(vehicle) : VehicleStats.getModel(vehicle); return model.name || model.make + ' ' + model.model; };
  const aircraftCondition = vehicle => clamp((vehicle.health ?? 100) / (vehicle.maxHealth || aircraftModel(vehicle).maxHealth || 100), 0, 1);
  const aircraftStatus = vehicle => vehicle.exploded || vehicle.health <= 0 ? 'Needs hangar recovery' : vehicle.burning ? `ENGINE FIRE · ${controlKey('bail', controls.groupFor(vehicle))} to parachute` : vehicle.stalled ? 'STALL · lower nose / add throttle' : vehicle.stallWarning ? 'LOW AIRSPEED · add throttle' : (vehicle.flightPhase || vehicle.phase || (vehicle.grounded ? 'parked' : 'cruise')).replaceAll('-', ' ').toUpperCase();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const menuBusy = () => settingsOpen || mapOpen || wheelOpen || inventoryView !== null;
  const mouseLocked = () => document.pointerLockElement === canvas;
  const playActive = () => started && !paused && !menuBusy() && !graphicsFailed && !game.garageService && $('help-screen').hidden && !document.hidden;
  const uiAudioActive = () => started && !paused && (menuBusy() || Boolean(game.garageService)) && !graphicsFailed && $('help-screen').hidden && !document.hidden;

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
      audioSettings = normalizeSettings(saved.settings?.audio);
      reducedMotion = saved.settings?.reducedMotion ?? reducedMotion;
      const savedSensitivity = saved.settings?.cameraSensitivity;
      if (typeof savedSensitivity === 'number' && Number.isFinite(savedSensitivity)) cameraSensitivity = clamp(savedSensitivity, 0.25, 2);
      cameraInvertY = saved.settings?.cameraInvertY === true;
      controlSettings = controls.normalizeSettings(saved.settings?.controls);
    }
  } catch (_) { saveBlocked = true; }
  const audio = new AudioDirector({ settings: { ...audioSettings, muted } });
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, progress: game.exportSave(), settings: { muted, audio: audioSettings, reducedMotion, cameraSensitivity, cameraInvertY, controls: controlSettings } }));
    } catch (_) {
      if (!saveBlocked) toast('Local saving is unavailable. You can still play this session.');
      saveBlocked = true;
    }
  }
  function audioStart() {
    audio.unlock().then(() => { updateAudio(); settingsUI(); });
  }
  function sound(name, details) {
    if (uiAudioActive()) audio.playUI(name, game, details);
    else audio.play(name, game, details);
  }
  function movementInput() {
    const direction = isAircraft(game.current) && MayhemAircraft.weaponsFor(game.current) && (firing || altFiring) ? scene?.aimDirection() : null;
    return { ...controls.readInput(controlSettings, activeControlGroup(), keys), fire: firing, altFire: altFiring,
      aimAngle: direction?.angle ?? scene?.viewYaw ?? game.current.angle, aimPitch: direction?.pitch ?? scene?.viewPitch ?? 0 };
  }
  function updateAudio(dt = 0) {
    audio.update(game, { active: playActive(), allowUI: uiAudioActive(), viewYaw: scene?.viewYaw ?? game.current.angle, input: movementInput(), dt });
  }
  function applyAudioSettings() {
    audio.setSettings({ ...audioSettings, muted });
    updateAudio(); settingsUI(); save();
  }
  function cycleRadio(direction) {
    if (!playActive() || !game.player.vehicleId) return;
    const choices = [...STATIONS.map(station => station.id), 'off'];
    const index = choices.indexOf(audioSettings.radioStation);
    audioSettings.radioStation = choices[(index + direction + choices.length) % choices.length];
    audioStart(); applyAudioSettings();
    sound('radio'); canvas.focus({ preventScroll: true });
  }
  function radioUI() {
    const driving = Boolean(game.player.vehicleId);
    $('radio-panel').hidden = !started || !driving || graphicsFailed;
    $('equipped-panel').hidden = Boolean(game.player.trainRide) || driving && !(isAircraft(game.current) && MayhemAircraft.weaponsFor(game.current));
    const station = STATIONS.find(item => item.id === audioSettings.radioStation);
    const name = station?.name || 'Radio off';
    const status = muted || audioSettings.masterVolume === 0 ? 'Sound muted' : audioSettings.musicVolume === 0 ? 'Music volume 0' : audio.getStatus().state === 'unavailable' ? 'Audio unavailable' : station?.genre || 'Enjoy the engine';
    if ($('radio-status').textContent !== name) $('radio-status').textContent = name;
    $('radio-genre').textContent = status;
    const reason = !driving ? 'Hop in a vehicle to change radio stations.' : !playActive() ? 'Resume playing and close any menus to change stations.' : '';
    buttonState($('radio-previous'), reason, 'Previous station · B');
    buttonState($('radio-next'), reason, 'Next station · N');
  }
  function events() {
    for (const event of game.drainEvents()) {
      if (event.type === 'toast') toast(event.text, event.kind);
      if (event.type === 'sound') sound(event.name, event.details);
    }
  }
  function settingsUI() {
    $('sound-toggle').textContent = audio.getStatus().state === 'unavailable' ? 'Sound: unavailable' : muted ? 'Sound: off' : 'Sound: on';
    $('sound-toggle').setAttribute('aria-pressed', String(!muted));
    const outputPercent = Math.round(audioSettings.outputVolume * 100);
    $('audio-output').value = outputPercent;
    $('audio-output').setAttribute('aria-valuetext', outputPercent + '%');
    $('audio-output-value').textContent = outputPercent + '%';
    $('motion-toggle').textContent = reducedMotion ? 'Motion: calm' : 'Motion: full';
    $('motion-toggle').setAttribute('aria-pressed', String(reducedMotion));
    document.body.classList.toggle('reduced-motion', reducedMotion);
    $('camera-sensitivity').value = cameraSensitivity;
    $('camera-sensitivity-value').textContent = cameraSensitivity.toFixed(2) + '×';
    $('camera-invert-y').checked = cameraInvertY;
    $('settings-motion').checked = reducedMotion;
    $('settings-muted').checked = muted;
    for (const category of ['master', 'music', 'effects']) {
      const value = audioSettings[category + 'Volume'];
      $('audio-' + category).value = value;
      $('audio-' + category + '-value').textContent = Math.round(value * 100) + '%';
    }
    $('radio-station').value = audioSettings.radioStation;
    radioUI();
  }
  function renderControlSettings(message = '') {
    bindingCapture = null;
    const config = controlSettings[controlGroup];
    $('control-type').value = controlGroup;
    $('control-preset').replaceChildren(...controls.presets(controlGroup).map(preset => new Option(preset.name, preset.id)));
    $('control-preset').value = config.preset;
    const customized = JSON.stringify(config.bindings) !== JSON.stringify(controls.defaults(controlGroup, config.preset));
    $('control-customized').textContent = customized ? 'Custom keys · based on selected preset' : 'Preset keys';
    $('control-bindings').replaceChildren(...controls.actions(controlGroup, config.preset).map(item => {
      const row = document.createElement('div'), label = document.createElement('span'), button = document.createElement('button');
      label.textContent = item.label;
      button.type = 'button'; button.className = 'key-binding'; button.dataset.action = item.id;
      button.textContent = controls.bindingLabel(controlSettings, controlGroup, item.id);
      button.setAttribute('aria-label', item.label + ': ' + button.textContent + '. Change key');
      row.append(label, button); return row;
    }));
    $('control-message').textContent = message || (controlGroup === 'plane' && config.preset !== 'legacy' ? `${controlKey('pitchDown', 'plane')} lowers the nose; ${controlKey('pitchUp', 'plane')} raises it. ${controlKey('interact', 'plane')} exits after landing. Throttle holds when released.` : 'Choose a key to change it. Each vehicle type keeps its own layout.');
    updateControlHints();
  }
  function flightControlsHint(group) {
    const key = id => controlKey(id, group);
    if (group === 'helicopter') return `${key('up')} / ${key('down')} forward / back · ${key('left')} / ${key('right')} turn · ${key('climb')} / ${key('descend')} altitude · ${key('hover')} hover · ${key('bail')} parachute`;
    if (controlSettings.plane.preset === 'legacy') return `${key('up')} / ${key('down')} throttle · ${key('left')} / ${key('right')} bank · ${key('climb')} / ${key('descend')} pitch · ${key('boost')} boost · ${key('interact')} exit`;
    return `${key('pitchDown')} / ${key('pitchUp')} pitch · ${key('rollLeft')} / ${key('rollRight')} roll · ${key('yawLeft')} / ${key('yawRight')} yaw · ${key('throttleUp')} / ${key('throttleDown')} throttle · ${key('interact')} exit · ${key('bail')} parachute`;
  }
  function updateControlHints() {
    for (const element of document.querySelectorAll('[data-controls-hint]')) element.textContent = flightControlsHint(element.dataset.controlsHint);
    $('play-control-hint').textContent = 'Mouse look · Right aim · Left fire · Tab toys · I pockets · G garage · M map · Esc pause · Settings changes keys';
  }
  function openSettings() {
    if (settingsOpen) return;
    settingsReturnFocus = document.activeElement;
    settingsWasPaused = !$('help-screen').hidden ? helpWasPaused : paused;
    $('help-screen').hidden = true;
    closeMap(false); closeWheel(false, false); closeInventory(false);
    settingsOpen = true; if (started) paused = true;
    releaseMouse(); $('pause-screen').hidden = true;
    $('settings-screen').hidden = false;
    controlGroup = game.player.vehicleId ? activeControlGroup() : 'plane';
    settingsUI(); renderControlSettings(); $('close-settings').focus({ preventScroll: true }); updateAudio();
  }
  function closeSettings() {
    if (!settingsOpen) return;
    bindingCapture = null; settingsOpen = false; $('settings-screen').hidden = true;
    keys.clear(); if (started) setPause(settingsWasPaused);
    if (!started || paused) (settingsReturnFocus?.getClientRects().length ? settingsReturnFocus : $('settings-toggle')).focus({ preventScroll: true });
  }
  for (const id of ['settings-toggle', 'pause-settings', 'help-settings']) $(id).addEventListener('click', openSettings);
  $('close-settings').addEventListener('click', closeSettings);
  $('control-type').addEventListener('change', event => { controlGroup = event.target.value; keys.clear(); renderControlSettings(); });
  $('control-preset').addEventListener('change', event => { controls.setPreset(controlSettings, controlGroup, event.target.value); keys.clear(); renderControlSettings('Preset applied and saved.'); save(); });
  $('reset-controls').addEventListener('click', () => { controls.setPreset(controlSettings, controlGroup, controlSettings[controlGroup].preset); keys.clear(); renderControlSettings('Keys restored to the selected preset.'); save(); });
  $('control-bindings').addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    renderControlSettings(); bindingCapture = button.dataset.action;
    const active = $('control-bindings').querySelector('[data-action="' + bindingCapture + '"]');
    active.textContent = 'Press a key…'; active.setAttribute('aria-pressed', 'true'); active.focus();
    $('control-message').textContent = 'Press a new key. Esc cancels. Menu keys Esc, Tab, P, M, I and G are reserved.';
  });
  $('settings-motion').addEventListener('change', event => { reducedMotion = event.target.checked; settingsUI(); save(); });
  $('settings-muted').addEventListener('change', event => { muted = event.target.checked; audioStart(); applyAudioSettings(); });
  function settingsKeydown(event) {
    if (bindingCapture) {
      event.preventDefault();
      if (event.repeat) return;
      const id = bindingCapture;
      if (event.code === 'Escape') renderControlSettings('Key change cancelled.');
      else if (event.metaKey || event.altKey || event.ctrlKey && !event.code.startsWith('Control')) { $('control-message').textContent = 'Choose a single key, without a shortcut combination.'; return; }
      else {
        const result = controls.rebind(controlSettings, controlGroup, id, event.code);
        if (result.error) { $('control-message').textContent = result.error; return; }
        keys.clear(); renderControlSettings('Key saved.'); save();
      }
      $('control-bindings').querySelector('[data-action="' + id + '"]').focus();
    } else if (event.code === 'Escape') { event.preventDefault(); closeSettings(); }
    else if (event.code === 'Tab') {
      const focusable = [...$('settings-screen').querySelectorAll('button, select, input')].filter(element => !element.disabled && element.getClientRects().length);
      const index = focusable.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) { event.preventDefault(); focusable[0]?.focus(); }
    }
  }
  function setAim(value) {
    aiming = Boolean(value && playActive() && mouseLocked() && !game.player.vehicleId && !game.player.trainRide && !game.physics?.get('player'));
    scene?.setAiming(aiming);
  }
  function releaseMouse() {
    setAim(false); keys.clear(); firing = altFiring = false;
    if (mouseLocked()) { intentionalUnlock = true; document.exitPointerLock(); }
  }
  function lockMouse() {
    if (!playActive() || mouseLocked() || mouseLockPending) return;
    if (!canvas.requestPointerLock) { toast('Mouse look is unavailable here. Open the game directly in Chrome.'); return; }
    canvas.focus({ preventScroll: true }); intentionalUnlock = false; mouseLockPending = true;
    try {
      const request = canvas.requestPointerLock();
      request?.catch(() => {
        mouseLockPending = false;
        if (playActive()) toast('Click the town again to look around. Esc releases the mouse.');
      });
    } catch (_) { mouseLockPending = false; toast('Click the town again to look around.'); }
  }
  function toyDirection() {
    return scene?.aimDirection() || { angle: scene?.viewYaw ?? game.player.angle, pitch: 0 };
  }
  function useToy() {
    if (!playActive() || !mouseLocked() || game.player.vehicleId || game.physics?.get('player')) return;
    const direction = toyDirection();
    game.player.aimPitch = direction.pitch;
    game.action(direction.angle, { pitch: direction.pitch }); events();
  }
  $('camera-sensitivity').addEventListener('input', event => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) cameraSensitivity = clamp(value, 0.25, 2);
    settingsUI(); save();
  });
  $('camera-invert-y').addEventListener('change', event => { cameraInvertY = event.target.checked; settingsUI(); save(); });
  $('audio-output').addEventListener('input', event => {
    audioSettings = normalizeSettings({ ...audioSettings, outputVolume: Number(event.target.value) / 100 });
    applyAudioSettings();
  });
  for (const category of ['master', 'music', 'effects']) {
    $('audio-' + category).addEventListener('input', event => {
      audioSettings = normalizeSettings({ ...audioSettings, [category + 'Volume']: Number(event.target.value) });
      audioStart(); applyAudioSettings();
    });
  }
  $('radio-station').addEventListener('change', event => {
    audioSettings = normalizeSettings({ ...audioSettings, radioStation: event.target.value });
    audioStart(); applyAudioSettings();
  });
  $('radio-previous').addEventListener('click', () => cycleRadio(-1));
  $('radio-next').addEventListener('click', () => cycleRadio(1));
  document.addEventListener('pointerlockchange', () => {
    mouseLockPending = false;
    if (mouseLocked()) {
      keys.clear();
      if (!playActive()) releaseMouse();
    } else {
      setAim(false); keys.clear(); firing = altFiring = false;
      if (!intentionalUnlock && playActive()) setPause(true);
      intentionalUnlock = false;
    }
  });
  document.addEventListener('pointerlockerror', () => {
    mouseLockPending = false;
    if (playActive()) toast('Click the town again to look around. Esc releases the mouse.');
  });
  function openMap() {
    if (!playActive()) return;
    mapOpen = true; releaseMouse();
    $('map-screen').hidden = false; $('close-map').focus({ preventScroll: true });
    updateAudio(); sound('menu-open');
  }
  function closeMap(focus = true) {
    if (!mapOpen) return;
    mapOpen = false; $('map-screen').hidden = true; keys.clear();
    if (focus && started && !paused) canvas.focus({ preventScroll: true });
    updateAudio();
    if (focus && playActive()) sound('menu-close');
  }
  $('close-map').addEventListener('click', () => closeMap());
  function toyDetail(id) {
    if (!game.inventory.unlocked.includes(id)) return 'LOCKED · ' + money(GADGETS[id].price);
    return id === 'cannon' ? game.inventory.ammo.cannon + ' / 12 charges' : 'Unlimited nonsense';
  }
  function renderWheel() {
    document.querySelectorAll('.wheel-option').forEach(button => {
      const id = button.dataset.gadget, selected = toyIds[wheelIndex] === id;
      buttonState(button, !game.inventory.unlocked.includes(id) ? 'Unlock the ' + GADGETS[id].name + ' at Sprinkle Garage for ' + money(GADGETS[id].price) + '.' : '');
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
    if (game.garageService) return;
    if (!started || paused || mapOpen || graphicsFailed || !$('help-screen').hidden || inventoryView) return;
    if (game.physics?.get('player')) { toast('Find your feet before changing toys. R skips the drama.'); return; }
    wheelOpen = true; keys.clear(); releaseMouse();
    wheelIndex = toyIds.indexOf(game.inventory.equipped);
    $('toy-wheel').hidden = false; renderWheel();
    updateAudio();
    sound('menu-open');
  }
  function closeWheel(equip = false, focus = true) {
    if (!wheelOpen) return;
    if (equip) { game.equipGadget(toyIds[wheelIndex]); events(); save(); }
    wheelOpen = false; $('toy-wheel').hidden = true; keys.clear();
    if (focus && started && !paused) canvas.focus({ preventScroll: true });
    updateAudio();
    if (focus && playActive()) sound('menu-close');
  }
  function cycleWheel(direction) {
    const previous = wheelIndex;
    for (let i = 0; i < toyIds.length; i++) {
      wheelIndex = (wheelIndex + direction + toyIds.length) % toyIds.length;
      if (game.inventory.unlocked.includes(toyIds[wheelIndex])) break;
    }
    renderWheel();
    if (wheelIndex !== previous) sound('menu-select');
  }
  function closeInventory(focus = true) {
    const wasOpen = inventoryView !== null;
    inventoryView = null; $('inventory-screen').hidden = true; keys.clear();
    if (focus && started && !paused) canvas.focus({ preventScroll: true });
    updateAudio();
    if (wasOpen && focus && playActive()) sound('menu-close');
  }
  function openInventory(view) {
    if (game.garageService) return;
    if (!started) start();
    if (paused || mapOpen || graphicsFailed || !$('help-screen').hidden || !started) return;
    const previousView = inventoryView;
    closeWheel(false, false); keys.clear(); releaseMouse();
    if (inventoryView !== view) $('inventory-screen').querySelector('.inventory-scroll').scrollTop = 0;
    inventoryView = view; $('inventory-screen').hidden = false;
    for (const [name, panel, tab] of [['pockets', 'pockets-panel', 'pockets-tab'], ['garage', 'collection-panel', 'collection-tab'], ['hangar', 'hangar-panel', 'hangar-tab']]) {
      $(panel).hidden = view !== name; $(tab).setAttribute('aria-selected', String(view === name)); $(tab).tabIndex = view === name ? 0 : -1;
    }
    $('inventory-title').textContent = view === 'pockets' ? 'Pockets full of possibilities.' : view === 'hangar' ? 'A little more altitude.' : 'Your questionable collection.';
    renderInventory();
    $(view === 'pockets' ? 'pockets-tab' : view === 'hangar' ? 'hangar-tab' : 'collection-tab').focus({ preventScroll: true });
    updateAudio();
    if (previousView !== view) sound(previousView ? 'menu-select' : 'menu-open');
  }
  function renderGarage() {
    const records = game.garage.cars.map(record => {
      const deployed = game.cars.find(car => car.garageId === record.id);
      return { ...record, ...(deployed ? { health: deployed.health, engineHealth: deployed.engineHealth, handlingHealth: deployed.handlingHealth, burning: deployed.burning, exploded: deployed.exploded } : {}), maxHealth: game.maxHealth };
    });
    $('garage-count').textContent = records.length + ' / 3 rides';
    $('garage-empty').hidden = records.length !== 0;
    const currentSaved = records.some(record => record.id === game.current.garageId);
    buttonState($('store-car'), currentSaved ? 'This ride is already saved in your garage.' : records.length >= 3 ? 'Your garage has 3 rides. Release a slot before saving another.' : !game.player.vehicleId || isAircraft(game.current) ? 'Hop in a car to save it in your garage.' : !game.garageAvailable ? garageHint : '');
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
      const name = document.createElement('h3'); name.className = 'saved-car-name'; name.textContent = vehicleName(record);
      const condition = document.createElement('p'); condition.className = 'saved-car-condition'; condition.textContent = Math.round(VehicleStats.condition(record) * 100) + '% body · ' + Math.round(record.engineHealth ?? 100) + '% engine · ' + Math.round(record.handlingHealth ?? 100) + '% handling · ' + VehicleStats.status(record);
      const stats = document.createElement('p'); stats.className = 'saved-car-condition';
      const effective = VehicleStats.performance(record);
      stats.textContent = 'Accel ' + (effective.acceleration / 20).toFixed(1) + ' m/s² · top ' + Math.round(effective.maxSpeed * 3.6 / 20) + ' km/h · handling ' + effective.handling.toFixed(1);
      copy.append(name, condition, stats); heading.append(copy);
      const badge = document.createElement('span'); badge.className = 'saved-car-badge'; badge.style.background = record.color; badge.setAttribute('aria-label', 'Current paint ' + record.color); heading.append(badge);
      const actions = document.createElement('div'); actions.className = 'saved-car-actions';
      const retrieve = document.createElement('button'); retrieve.type = 'button'; retrieve.className = 'inventory-action'; retrieve.dataset.retrieveCar = record.id; retrieve.textContent = record.health <= 0 || record.burning || record.exploded ? 'Needs repair first' : 'Bring it out ↗';
      buttonState(retrieve, record.health <= 0 || record.burning || record.exploded ? 'Repair this ride before bringing it out.' : !game.garageAvailable ? garageHint : ''); actions.append(retrieve);
      const repair = document.createElement('button'); repair.type = 'button'; repair.className = 'inventory-action'; repair.dataset.repairCar = record.id; repair.textContent = 'Un-dent · $45';
      buttonState(repair, !VehicleStats.isDamaged(record) ? 'This ride is already in perfect condition.' : !game.garageAvailable ? garageHint : game.money < 45 ? cashHint(45) : ''); actions.append(repair);
      const release = document.createElement('button'); release.type = 'button'; release.className = 'inventory-action'; release.dataset.releaseCar = record.id; release.textContent = 'Release slot';
      buttonState(release, !game.garageAvailable ? garageHint : '', 'Remove ownership; any deployed car stays in town'); actions.append(release);
      const swatches = document.createElement('div'); swatches.className = 'garage-swatches'; swatches.setAttribute('aria-label', 'Paint choices · $25 each');
      for (const color of PAINT_COLORS) {
        const paint = document.createElement('button'); paint.type = 'button'; paint.className = 'paint-swatch'; paint.style.setProperty('--paint', color);
        paint.dataset.paintCar = record.id; paint.dataset.color = color;
        paint.title = color === record.color ? 'Current paint' : 'Paint ' + color + ' · $25';
        paint.setAttribute('aria-label', paint.title); paint.setAttribute('aria-pressed', String(color === record.color));
        buttonState(paint, color === record.color ? 'This ride is already painted this color.' : !game.garageAvailable ? garageHint : game.money < 25 ? cashHint(25) : '', paint.title);
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
  function renderHangar() {
    const records = game.hangar?.aircraft || [], available = game.hangarAvailable === true;
    $('hangar-count').textContent = records.length + ' / 3 aircraft';
    $('hangar-empty').hidden = records.length !== 0;
    const currentSaved = records.some(record => record.id === game.current.hangarId);
    buttonState($('store-aircraft'), currentSaved ? 'This aircraft is already saved in your hangar.' : records.length >= 3 ? 'Your hangar has 3 aircraft. Release a slot before saving another.' : !isAircraft(game.current) ? 'Board an aircraft to save it in your hangar.' : !available ? hangarHint : '');
    $('store-aircraft').textContent = currentSaved ? 'Aircraft already saved' : records.length >= 3 ? 'Hangar full · release a slot' : 'Save current aircraft';
    const signature = JSON.stringify([records, (game.aircraft || []).map(aircraft => [aircraft.id, aircraft.hangarId, aircraft.health, aircraft.engineHealth]), available, game.money]);
    if (signature === hangarSignature) return;
    hangarSignature = signature;
    const fragment = document.createDocumentFragment();
    for (const record of records) {
      const deployed = game.aircraft?.find(aircraft => aircraft.hangarId === record.id), aircraft = { ...record, ...deployed, kind: 'aircraft' };
      const card = document.createElement('article'); card.className = 'saved-car';
      const heading = document.createElement('h3'); heading.className = 'saved-car-name'; heading.textContent = vehicleName(aircraft);
      const condition = document.createElement('p'); condition.className = 'saved-car-condition'; condition.textContent = Math.round(aircraftCondition(aircraft) * 100) + '% airframe · ' + Math.round(aircraft.engineHealth ?? 100) + '% engine · ' + aircraftModel(aircraft).seats + ' seats';
      const actions = document.createElement('div'); actions.className = 'saved-car-actions';
      const damaged = aircraftCondition(aircraft) < 1 || aircraft.engineHealth < 100 || aircraft.burning || aircraft.exploded;
      for (const [action, label, reason] of [
        ['retrieve', 'Bring to stand ↗', aircraft.health <= 0 || aircraft.burning || aircraft.exploded ? 'Service this aircraft before bringing it to a stand.' : !available ? hangarHint : ''],
        ['repair', 'Service · $75', !damaged ? 'This aircraft is already in perfect condition.' : !available ? hangarHint : game.money < 75 ? cashHint(75) : ''],
        ['release', 'Release slot', !available ? hangarHint : '']
      ]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'inventory-action'; button.dataset.hangarAction = action; button.dataset.aircraftId = record.id; button.textContent = label; buttonState(button, reason); actions.append(button);
      }
      card.append(heading, condition, actions); fragment.append(card);
    }
    $('hangar-aircraft').replaceChildren(fragment);
  }
  function renderInventory() {
    if (!inventoryView) return;
    const available = game.garageAvailable, fallen = !!game.physics?.get('player');
    const atService = inventoryView === 'hangar' ? game.hangarAvailable === true : available;
    $('inventory-location').textContent = inventoryView === 'hangar' ? (atService ? 'At the airfield · store, retrieve or service your aircraft.' : 'Browse anywhere. Land and stop at either airfield apron to manage aircraft.') : available ? 'At Sprinkle Garage · supplies, toys and car care are open.' : 'Browse anywhere. Visit Sprinkle Garage and stop to shop or manage rides.';
    $('inventory-location').dataset.available = String(atService);
    $('inventory-location').classList.toggle('available', atService);
    for (const id of Object.keys(POCKET_ITEMS)) {
      const definition = POCKET_ITEMS[id], count = game.inventory.pockets[id];
      const card = document.querySelector('[data-pocket="' + id + '"]');
      card.querySelector('.pocket-count').textContent = count + ' / ' + definition.cap;
      card.querySelector('.pocket-description').textContent = definition.description;
      const use = card.querySelector('[data-use-pocket]'), buy = card.querySelector('[data-buy-pocket]');
      let useHint = '';
      if (id === 'biscuits' && game.player.composure >= 100) useHint = 'Your composure is already full.';
      if (id === 'repairTape') {
        if (!game.player.vehicleId) useHint = 'Hop in a damaged ride to use repair tape.';
        else if (Math.abs(game.current.speed || 0) > 45) useHint = 'Stop your ride before applying repair tape.';
        else if (!VehicleStats.isDamaged(game.current)) useHint = 'This ride is already in perfect condition.';
      }
      if (id === 'refill') {
        if (!game.inventory.unlocked.includes('cannon')) useHint = 'Unlock the Party Cannon at Sprinkle Garage before using a refill.';
        else if (game.inventory.ammo.cannon >= 12) useHint = 'Your Party Cannon is already full (12 charges).';
      }
      buttonState(use, fallen ? 'Find your feet before using pocket items.' : count <= 0 ? 'No ' + definition.name + ' left. Restock at Sprinkle Garage.' : useHint);
      use.textContent = id === 'refill' ? 'Load cannon' : 'Use one';
      buttonState(buy, count >= definition.cap ? 'Your pockets are full of ' + definition.name + ' (' + definition.cap + ' max).' : !available ? garageHint : game.money < definition.price ? cashHint(definition.price) : '');
      buy.textContent = 'Buy · ' + money(definition.price);
    }
    document.querySelectorAll('[data-shop-gadget]').forEach(card => {
      const id = card.dataset.shopGadget, owned = game.inventory.unlocked.includes(id), button = card.querySelector('[data-buy-gadget]');
      card.querySelector('.gadget-status').textContent = owned ? 'In your toy wheel' : GADGETS[id].description;
      card.querySelector('.gadget-price').textContent = owned ? 'UNLOCKED' : money(GADGETS[id].price);
      button.firstChild.nodeValue = owned ? 'Yours forever ' : 'Unlock toy ';
      buttonState(button, owned ? 'You already own the ' + GADGETS[id].name + '.' : !available ? garageHint : game.money < GADGETS[id].price ? cashHint(GADGETS[id].price) : '');
    });
    renderGarage();
    renderHangar();
  }
  function inventoryAction(action) {
    action(); events(); save(); renderInventory(); hud();
  }
  $('inventory-toggle').addEventListener('click', () => openInventory('pockets'));
  $('garage-toggle').addEventListener('click', () => openInventory('garage'));
  $('hangar-toggle').addEventListener('click', () => openInventory('hangar'));
  $('close-inventory').addEventListener('click', () => closeInventory());
  $('pockets-tab').addEventListener('click', () => openInventory('pockets'));
  $('collection-tab').addEventListener('click', () => openInventory('garage'));
  $('hangar-tab').addEventListener('click', () => openInventory('hangar'));
  $('store-car').addEventListener('click', () => inventoryAction(() => game.garageStore()));
  $('store-aircraft').addEventListener('click', () => inventoryAction(() => game.hangarStore()));
  $('inventory-screen').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.usePocket) inventoryAction(() => game.usePocket(button.dataset.usePocket));
    if (button.dataset.buyPocket) inventoryAction(() => game.purchasePocket(button.dataset.buyPocket));
    if (button.dataset.buyGadget) inventoryAction(() => game.purchaseGadget(button.dataset.buyGadget));
    if (button.dataset.retrieveCar) inventoryAction(() => { if (game.garageRetrieve(button.dataset.retrieveCar)) { closeInventory(); scene?.recenter(); } });
    if (button.dataset.paintCar) inventoryAction(() => game.garagePaint(button.dataset.paintCar, button.dataset.color));
    if (button.dataset.repairCar) inventoryAction(() => game.garageRepair(button.dataset.repairCar));
    if (button.dataset.releaseCar) inventoryAction(() => game.garageRelease(button.dataset.releaseCar));
    if (button.dataset.hangarAction) inventoryAction(() => {
      const id = button.dataset.aircraftId;
      if (button.dataset.hangarAction === 'retrieve' && game.hangarRetrieve(id)) { closeInventory(); scene?.recenter(); }
      if (button.dataset.hangarAction === 'repair') game.hangarRepair(id);
      if (button.dataset.hangarAction === 'release') game.hangarRelease(id);
    });
  });
  document.querySelectorAll('.wheel-option').forEach(button => {
    button.addEventListener('pointerenter', () => { if (wheelOpen && !button.disabled) { const previous = wheelIndex; wheelIndex = toyIds.indexOf(button.dataset.gadget); renderWheel(); if (wheelIndex !== previous) sound('menu-select'); } });
    button.addEventListener('click', () => { if (wheelOpen && !button.disabled) { wheelIndex = toyIds.indexOf(button.dataset.gadget); closeWheel(true); } });
  });
  $('toy-wheel').addEventListener('wheel', event => { if (wheelOpen) { event.preventDefault(); cycleWheel(event.deltaY >= 0 ? 1 : -1); } }, { passive: false });
  function setPause(value) {
    if (!started) return;
    closeMap(false); closeWheel(false, false); closeInventory(false);
    paused = value;
    keys.clear(); releaseMouse();
    $('pause-screen').hidden = !paused;
    updateAudio(); radioUI();
    if (!paused) { audioStart(); canvas.focus(); }
  }
  function start() {
    if (!scene || graphicsFailed) { graphicsError('This browser could not start 3D. Use a WebGL 2 capable browser with hardware acceleration enabled.'); return; }
    started = true; paused = false;
    $('start-screen').hidden = true;
    $('pause-screen').hidden = true;
    audioStart(); canvas.focus();
    toast('Click the town to look around. Right mouse aims; left mouse uses your toy. Esc releases the mouse.');
    if (saveBlocked) toast('Saving is unavailable here. The full game still works this session.');
  }
  $('play-button').addEventListener('click', start);
  $('reload-button').addEventListener('click', () => location.reload());
  $('fullscreen-toggle').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.querySelector('.app').requestFullscreen();
      if (started && !paused && !menuBusy()) canvas.focus({ preventScroll: true });
    } catch (_) { toast('Full screen is unavailable in this browser.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen-toggle').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    $('fullscreen-toggle').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
  });
  $('resume-button').addEventListener('click', () => setPause(false));
  $('restart-button').addEventListener('click', () => { game.recover(); setPause(false); events(); save(); });
  $('recover-button').addEventListener('click', () => { if (!started) start(); if (graphicsFailed) return; closeMap(false); closeWheel(false, false); closeInventory(false); game.recover(); events(); canvas.focus(); });
  $('sound-toggle').addEventListener('click', () => { muted = !muted; audioStart(); applyAudioSettings(); if (started && !paused && !menuBusy() && $('help-screen').hidden) canvas.focus(); });
  $('motion-toggle').addEventListener('click', () => { reducedMotion = !reducedMotion; settingsUI(); save(); if (started && !paused && !menuBusy() && $('help-screen').hidden) canvas.focus(); });
  $('help-toggle').addEventListener('click', () => {
    if (settingsOpen) return;
    closeMap(false); closeWheel(false, false); closeInventory(false);
    helpWasPaused = paused;
    if (started) { paused = true; keys.clear(); releaseMouse(); }
    $('help-screen').hidden = false; $('close-help').focus();
    updateAudio();
  });
  function closeHelp() {
    $('help-screen').hidden = true;
    if (started) setPause(helpWasPaused);
  }
  $('close-help').addEventListener('click', closeHelp);
  document.querySelectorAll('.contract-button').forEach(button => button.addEventListener('click', () => {
    if (!started) start();
    if (paused || menuBusy() || !$('help-screen').hidden) { toast('Resume the game to accept a gig.'); return; }
    if (['airtaxi', 'aircargo', 'sightseeing', 'airrace'].includes(button.dataset.mission)) game.startMission(button.dataset.mission);
    else game.acceptMission(button.dataset.mission);
    events(); canvas.focus();
  }));
  document.querySelectorAll('.purchase-button').forEach(button => button.addEventListener('click', () => {
    if (!started || paused || menuBusy() || !$('help-screen').hidden) { toast('Visit a garage while playing to buy a tune-up.'); return; }
    game.purchase(button.dataset.upgrade); events(); save(); canvas.focus();
  }));
  $('abandon-button').addEventListener('click', () => { if (!paused && !menuBusy() && started) { game.abandonMission(); events(); canvas.focus(); } });
  $('airport-route').addEventListener('click', () => {
    const airport = game.world.landscape?.airport || game.world.airport;
    const pad = airport?.helipads?.[0];
    if (!pad) return;
    navigationTarget = { x: pad.x, y: pad.y, name: 'Meadows Airport' };
    if (!started) start();
    toast('Airport marked on your compass. Follow Terminal Avenue to the airfield in the northeast.');
    canvas.focus(); hud();
  });
  $('military-route').addEventListener('click',()=>{
    const base=game.world.militaryBase;if(!base)return;
    navigationTarget={x:base.gate.x,y:base.gate.y,name:base.name};
    if(!started)start();toast('Northwatch Airbase marked. Follow Pine Ridge Road north through the pass.');canvas.focus();hud();
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  // Mouse edges fire for each button in a chord, including aim + fire.
  canvas.addEventListener('mousedown', event => {
    if (!playActive()) return;
    canvas.focus({ preventScroll: true }); audioStart();
    event.preventDefault();
    if (!mouseLocked()) { lockMouse(); return; }
    if (event.button === 2) { if (isAircraft(game.current)) altFiring = true; else setAim(true); }
    if (event.button === 0) { firing = isAircraft(game.current) || isTank(game.current); useToy(); }
  });
  canvas.addEventListener('pointermove', event => {
    if (mouseLocked() && playActive()) scene?.orbit(event.movementX, event.movementY, { sensitivity: cameraSensitivity * (aiming ? 0.55 : 1), invertY: cameraInvertY });
  });
  window.addEventListener('mouseup', event => { if (event.button === 2) { setAim(false); altFiring = false; } if (event.button === 0) firing = false; });
  canvas.addEventListener('pointercancel', () => { setAim(false); firing = altFiring = false; });
  window.addEventListener('keydown', event => {
    if (settingsOpen) { settingsKeydown(event); return; }
    if (event.metaKey || event.altKey || event.ctrlKey && !event.code.startsWith('Control') && !keys.has('ControlLeft') && !keys.has('ControlRight')) return;
    if (event.code === 'Escape' && !$('help-screen').hidden) { event.preventDefault(); closeHelp(); return; }
    if (!started || !$('help-screen').hidden) return;
    if (mapOpen) {
      if (!['Enter', 'Space'].includes(event.code)) event.preventDefault();
      if (!event.repeat && (event.code === 'KeyM' || event.code === 'Escape')) closeMap();
      else if (event.code === 'Tab') $('close-map').focus({ preventScroll: true });
      return;
    }
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
        if (!event.repeat) {
          const views = ['pockets', 'garage', 'hangar'], direction = event.code === 'ArrowLeft' ? -1 : 1;
          openInventory(event.code === 'Home' ? 'pockets' : event.code === 'End' ? 'hangar' : views[(views.indexOf(inventoryView) + direction + views.length) % views.length]);
        }
      } else if (event.code === 'Escape' || event.code === 'KeyI' || event.code === 'KeyG') {
        event.preventDefault();
        if (!event.repeat) {
          const requested = event.code === 'KeyI' ? 'pockets' : event.code === 'KeyG' ? (game.hangarAvailable ? 'hangar' : 'garage') : null;
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
    if (game.garageService) { event.preventDefault(); return; }
    if (event.code === 'KeyM') {
      event.preventDefault();
      if (!event.repeat) openMap();
      return;
    }
    if (event.code === 'Tab') { event.preventDefault(); if (!event.repeat) openWheel(); return; }
    if (event.code === 'KeyI' || event.code === 'KeyG') { event.preventDefault(); if (!event.repeat) openInventory(event.code === 'KeyI' ? 'pockets' : game.hangarAvailable ? 'hangar' : 'garage'); return; }
    const action = controls.actionForKey(controlSettings, activeControlGroup(), event.code);
    if (!action) return;
    event.preventDefault(); keys.add(event.code);
    if (!event.repeat) {
      audioStart();
      if (action === 'jump' && !game.player.vehicleId) game.jump();
      if (action === 'interact') { game.interact(); keys.clear(); firing = altFiring = false; setAim(false); }
      if (action === 'horn') game.horn();
      if (action === 'recover') { game.recover(); keys.clear(); firing = altFiring = false; setAim(false); scene?.recenter(); }
      if (action === 'recenter') scene?.recenter();
      if (action === 'bail' || action === 'flop') { if (isAircraft(game.current) ? game.bailOut() : game.flop()) { keys.clear(); firing = altFiring = false; setAim(false); } }
      if (action === 'radioPrevious') cycleRadio(-1);
      if (action === 'radioNext') cycleRadio(1);
      updateAudio(); radioUI();
      events();
    }
  });
  window.addEventListener('keyup', event => { keys.delete(event.code); if (event.code === 'Tab' && wheelOpen) { event.preventDefault(); closeWheel(true); } });
  window.addEventListener('blur', () => { keys.clear(); if (started) setPause(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && started) { setPause(true); save(); } });
  window.addEventListener('beforeunload', save);
  settingsUI();

  function graphicsError(message) {
    closeMap(false); closeWheel(false, false); closeInventory(false);
    graphicsFailed = true; paused = true; keys.clear(); releaseMouse();
    $('renderer-error').hidden = false;
    $('renderer-error-detail').textContent = message;
    buttonState($('play-button'), message);
    $('pause-screen').hidden = true;
    updateAudio();
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
  const terrainMap = document.createElement('canvas');
  if (game.world.terrain) {
    const ground = game.world.terrain, n = ground.count,bounds=game.world.bounds||{minX:0,minY:0,maxX:SIZE,maxY:SIZE};
    terrainMap.width = terrainMap.height = n;
    const context = terrainMap.getContext('2d'), pixels = context.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const index = y * n + x, height = ground.heightAt(bounds.minX+x/(n-1)*(bounds.maxX-bounds.minX),bounds.minY+y/(n-1)*(bounds.maxY-bounds.minY)), water = height < .05;
      const shade = Math.min(1, Math.max(0, height / 42));
      const color = water ? [40, 113, 147] : height < .9 ? [198, 191, 143]
        : [91 + shade * 62, 140 + shade * 26, 94 + shade * 40];
      for (let channel = 0; channel < 3; channel++) pixels.data[index * 4 + channel] = color[channel];
      pixels.data[index * 4 + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }
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
  function target() { return game.mission?.targets?.[game.mission.targetIndex] || navigationTarget; }
  function drawAircraftMarker(aircraft, scale, w, h) {
    const controlled = game.player.vehicleId === aircraft.id, helicopter = isHelicopter(aircraft);
    const bounds=game.world.bounds||{minX:0,minY:0,maxX:SIZE,maxY:SIZE};
    const x = clamp(aircraft.x * scale, bounds.minX*scale+5,bounds.maxX*scale-5), y = clamp(aircraft.y * scale,bounds.minY*scale+5,bounds.maxY*scale-5);
    const altitude = Math.max(0, aircraft.altitudeAGL ?? aircraft.agl ?? 0);
    mini.save(); mini.translate(x, y);
    const military = aircraft.militaryResponse === true;
    mini.strokeStyle = controlled ? '#fff8d9' : military ? '#ffc56f' : aircraft.aircraftType === 'policeheli' ? '#ff8294' : aircraft.aircraftType === 'news' ? '#f5d96c' : '#70e6db';
    mini.fillStyle = mini.strokeStyle; mini.lineWidth = controlled ? 1.6 : 1;
    if (military && !controlled) {
      mini.beginPath(); mini.moveTo(0, -7); mini.lineTo(7, 0); mini.lineTo(0, 7); mini.lineTo(-7, 0); mini.closePath(); mini.stroke();
    }
    if (altitude > 2) { mini.globalAlpha = 0.35; mini.beginPath(); mini.arc(0, 0, controlled ? 7 : 5, 0, Math.PI * 2); mini.stroke(); mini.globalAlpha = 1; }
    mini.save(); mini.rotate(aircraft.angle || 0);
    if (helicopter) {
      mini.beginPath(); mini.ellipse(0, 0, 2.5, 1.7, 0, 0, Math.PI * 2); mini.fill();
      mini.beginPath(); mini.moveTo(-5, 0); mini.lineTo(4, 0); mini.moveTo(0, -4); mini.lineTo(0, 4); mini.stroke();
    } else {
      mini.beginPath(); mini.moveTo(5, 0); mini.lineTo(-3, -2); mini.lineTo(-2, 0); mini.lineTo(-3, 2); mini.closePath(); mini.fill();
      mini.beginPath(); mini.moveTo(0, -5); mini.lineTo(0, 5); mini.moveTo(-3, -2.5); mini.lineTo(-3, 2.5); mini.stroke();
    }
    mini.restore();
    if (altitude > 12) { mini.beginPath(); mini.moveTo(6, 2); mini.lineTo(6, -2); mini.lineTo(4.5, -.5); mini.moveTo(6, -2); mini.lineTo(7.5, -.5); mini.stroke(); }
    mini.restore();
  }
  function drawMinimap() {
    const r = minimap.getBoundingClientRect(), w = r.width, h = r.height, scale = w / SIZE;
    mini.clearRect(0, 0, w, h); mini.fillStyle = '#608d76'; mini.fillRect(0, 0, w, h);
    if (terrainMap.width > 0 && game.world.terrain) mini.drawImage(terrainMap, 0, 0, w, h);
    const bounds=game.world.bounds||{minX:0,minY:0,maxX:SIZE,maxY:SIZE};mini.save();mini.translate(-bounds.minX*scale,-bounds.minY*scale);
    mini.globalAlpha = game.world.terrain ? .22 : 1;
    for (const area of game.areas || []) {
      mini.fillStyle = DISTRICTS[area.district]?.mapColor || '#7e9f83';
      if (area.points?.length) {
        mini.beginPath();
        area.points.forEach((point, index) => { if (index) mini.lineTo(point.x * scale, point.y * scale); else mini.moveTo(point.x * scale, point.y * scale); });
        mini.closePath(); mini.fill();
      }
    }
    mini.globalAlpha = 1;
    mini.strokeStyle = '#3b4655'; mini.lineCap = 'round'; mini.lineJoin = 'round';
    for (const road of game.roads) {
      mini.lineWidth = Math.max(1.1, road.width * scale);
      mini.beginPath();
      road.points.forEach((point, index) => { if (index) mini.lineTo(point.x * scale, point.y * scale); else mini.moveTo(point.x * scale, point.y * scale); });
      mini.stroke();
    }
    mini.fillStyle = '#b3b7a0';
    mini.strokeStyle = '#dfc792';mini.lineWidth = 1.3;mini.setLineDash([2,1]);
    for(const track of game.world.railway?.tracks||[]) {
      mini.beginPath();track.points.forEach((point,i)=>i?mini.lineTo(point.x*scale,point.y*scale):mini.moveTo(point.x*scale,point.y*scale));mini.stroke();
    }
    mini.setLineDash([]);
    for (const building of game.buildings) {
      mini.save(); mini.translate((building.x + building.w / 2) * scale, (building.y + building.h / 2) * scale);
      mini.rotate(building.angle || 0);
      mini.fillRect(-building.w * scale / 2, -building.h * scale / 2, building.w * scale, building.h * scale);
      mini.restore();
    }
    for (const service of game.services) {
      mini.fillStyle = service.id === 'repair' ? '#70e6db' : '#e6f77c'; mini.fillRect(service.x * scale - 2, service.y * scale - 2, 4, 4);
      if (service.mapLabel) { mini.font = 'bold 5px system-ui'; mini.fillText(service.mapLabel, service.x * scale + 3, service.y * scale - 3); }
    }
    const airport = game.world.landscape?.airport || game.world.airport;
    for (const runway of [...(airport?.runways || []),...(game.world.militaryBase?.runways||[])]) {
      mini.fillStyle = '#eef4dd'; mini.fillRect(runway.x * scale, runway.y * scale, Math.max(1.5, runway.w * scale), runway.h * scale);
    }
    for (const pad of [...(airport?.helipads || []),...(game.world.militaryBase?.helipads||[])]) {
      mini.strokeStyle = '#70e6db'; mini.lineWidth = 0.8; mini.strokeRect(pad.x * scale - 2, pad.y * scale - 2, 4, 4);
    }
    const t = target();
    if (t) { mini.strokeStyle = '#effa88'; mini.lineWidth = 2; mini.beginPath(); mini.arc(t.x * scale, t.y * scale, 5, 0, Math.PI * 2); mini.stroke(); }
    for (const police of game.police) { mini.fillStyle = game.heat ? '#ff8294' : '#a7cee4'; mini.beginPath(); mini.arc(police.x * scale, police.y * scale, 2, 0, Math.PI * 2); mini.fill(); }
    for (const tank of game.cars.filter(isTank)) {
      if (tank.exploded || tank.health <= 0) continue;
      const x = tank.x * scale, y = tank.y * scale;
      mini.save(); mini.translate(x, y); mini.rotate(tank.angle || 0);
      mini.fillStyle = tank.id === game.player.vehicleId ? '#fff8d9' : '#ffc56f';
      mini.fillRect(-3.5, -2.5, 7, 5); mini.restore();
      const turret = tank.tankGun?.turretAngle ?? tank.turretAngle ?? tank.angle ?? 0;
      mini.strokeStyle = tank.id === game.player.vehicleId ? '#fff8d9' : '#ffc56f'; mini.lineWidth = 1.5;
      mini.beginPath(); mini.moveTo(x, y); mini.lineTo(x + Math.cos(turret) * 6, y + Math.sin(turret) * 6); mini.stroke();
    }
    for(const truck of game.militaryTrucks||[])if(!truck.exploded&&truck.health>0){
      mini.save();mini.translate(truck.x*scale,truck.y*scale);mini.rotate(truck.angle||0);
      mini.fillStyle=truck.id===game.player.vehicleId?'#fff8d9':'#dec49b';mini.fillRect(-3.5,-2,7,4);mini.restore();
    }
    for(const soldier of game.soldiers||[])if(!soldier.transportedBy){
      mini.fillStyle=game.heatLevel===MAX_HEAT?'#ffc56f':'#c0cdad';mini.beginPath();mini.arc(soldier.x*scale,soldier.y*scale,1.4,0,Math.PI*2);mini.fill();
    }
    for (const aircraft of game.aircraft || []) if (aircraft.active !== false && aircraft.visible !== false && !aircraft.exploded) drawAircraftMarker(aircraft, scale, w, h);
    for(const car of game.trainCars || [])if(car.visible){mini.save();mini.translate(car.x*scale,car.y*scale);mini.rotate(car.angle);mini.fillStyle=car.model==='passenger'?'#6ee4d5':'#f3c568';mini.fillRect(-2.5,-1.2,5,2.4);mini.restore();}
    if (!isAircraft(game.current)) {
      mini.save(); mini.translate(clamp(game.current.x * scale,bounds.minX*scale+5,bounds.maxX*scale-5), clamp(game.current.y * scale,bounds.minY*scale+5,bounds.maxY*scale-5)); mini.rotate(game.current.angle);
      mini.fillStyle = '#fff8d9'; mini.beginPath(); mini.moveTo(6, 0); mini.lineTo(-4, -4); mini.lineTo(-3, 0); mini.lineTo(-4, 4); mini.closePath(); mini.fill(); mini.restore();
    }
    mini.restore();
  }
  function render(dt) {
    const transition = game.garageTransition, fade = $('garage-fade');
    fade.hidden = !transition;
    fade.style.opacity = String(transition?.opacity || 0);
    fade.dataset.phase = transition?.phase || 'idle';
    $('game-shell').classList.toggle('garage-servicing', Boolean(transition));
    canvas.dataset.garagePhase = transition?.phase || 'idle';
    if (aiming && (!playActive() || !mouseLocked() || game.player.vehicleId || game.player.trainRide || game.physics?.get('player'))) setAim(false);
    if (scene && !graphicsFailed) { scene.update(dt, { reducedMotion, paused: paused || menuBusy() || !started || Boolean(game.garageService) }); renderedFrames++; }
  }
  function hud() {
    radioUI();
    drawMinimap();
    const train = game.ridingTrain;
    const trainService = train && game.railTraffic.services.find(service => service.id === train.serviceId);
    const tank = isTank(game.current);
    const tankReload = Math.max(0, Number.isFinite(game.current.gunCooldown) ? game.current.gunCooldown : 0);
    const tankGunStatus = game.current.health <= 0 || game.current.exploded ? 'CANNON DISABLED' : tankReload > 0 ? `RELOAD ${tankReload.toFixed(1)}s` : 'CANNON READY';
    const district = game.districtAt(game.current);
    $('district-name').textContent = district.name.toUpperCase();
    canvas.dataset.district = district.id;
    $('equipped-label').textContent = tank ? 'Tank cannon' : 'Equipped toy';
    $('equipped-shortcut').hidden = tank;
    $('equipped-toy').textContent = tank ? 'MOUSE AIM · ' + tankGunStatus : GADGETS[game.inventory.equipped].name + (game.inventory.equipped === 'cannon' ? ' · ' + game.inventory.ammo.cannon + ' charges' : '') + ' · TAB';
    canvas.dataset.equippedToy = game.inventory.equipped;
    canvas.dataset.inventoryMode = wheelOpen ? 'wheel' : inventoryView || 'none';
    canvas.dataset.mouseLocked = String(mouseLocked());
    canvas.dataset.aiming = String(aiming);
    renderInventory();
    const fallen = game.physics?.get('player');
    const flying = isAircraft(game.current), helicopter = flying && isHelicopter(game.current);
    canvas.dataset.ragdollCount = String(game.physics?.bodies.size || 0);
    canvas.dataset.playerRagdoll = fallen?.phase || 'none';
    canvas.dataset.playerRagdollAge = Number(fallen?.age || 0).toFixed(4);
    canvas.dataset.renderedRagdolls = String(scene?.ragdollCount || 0);
    const camera = scene?.cameraInfo;
    if (camera) {
      canvas.dataset.cameraMode = camera.mode;
      canvas.dataset.cameraYaw = Number(camera.viewYaw ?? scene.viewYaw).toFixed(4);
      canvas.dataset.cameraDistance = Number(camera.distance).toFixed(3);
      canvas.dataset.cameraPitch = Number(camera.viewPitch || 0).toFixed(4);
      canvas.dataset.cameraFov = Number(camera.fov || scene.camera.fov).toFixed(3);
      for (const name of ['x','y','z','targetX','targetY','targetZ']) canvas.dataset['camera' + name[0].toUpperCase() + name.slice(1)] = Number(camera[name]).toFixed(3);
      canvas.dataset.cameraObstructed = String(camera.obstructed);
      canvas.dataset.renderCalls = String(scene.renderer?.info.render.calls || 0);
    }
    canvas.dataset.worldX = game.current.x.toFixed(3); canvas.dataset.worldY = game.current.y.toFixed(3);
    canvas.dataset.elevation = Number(game.current.elevation || 0).toFixed(3);
    canvas.dataset.verticalVelocity = Number(game.current.verticalVelocity || 0).toFixed(3);
    canvas.dataset.grounded = String(game.current.grounded !== false);
    canvas.dataset.frames = String(renderedFrames);
    const airWeapons = flying && MayhemAircraft.weaponsFor(game.current), armedAircraft = Boolean(airWeapons);
    $('aim-reticle').hidden = !playActive() || !mouseLocked() || (!!game.player.vehicleId && !armedAircraft && !tank) || !!fallen;
    $('aim-reticle').classList.toggle('aiming', aiming);
    $('aim-reticle').dataset.weapon = tank ? 'tank' : armedAircraft ? 'aircraft' : 'toy';
    $('aim-reticle').dataset.reloading = String(tank && tankReload > 0);
    const weaponLock = armedAircraft && game.current.weaponLock;
    const lockTarget = weaponLock && [...game.aircraft, ...game.cars].find(entity => entity.id === weaponLock.targetId);
    const lockPoint = lockTarget && scene?.weaponTargetScreenPoint(lockTarget);
    const lockMarker = $('weapon-lock-marker');
    lockMarker.hidden = !lockPoint || !playActive() || !mouseLocked();
    if (lockPoint) { lockMarker.style.left = lockPoint.x + '%'; lockMarker.style.top = lockPoint.y + '%'; }
    if (armedAircraft) {
      const craft = game.current, reload = craft.secondaryCooldown || 0;
      const status = craft.health <= 0 || craft.exploded ? 'WEAPONS DISABLED' : craft.weaponServiceTime > 0 ? `REARMING ${Math.max(0, 3 - craft.weaponServiceTime).toFixed(1)}s` : craft.secondaryAmmo <= 0 ? 'EMPTY · stop at an airfield to rearm' : reload > 0 ? `RELOAD ${reload.toFixed(1)}s` : weaponLock ? `LOCK ${Math.floor(weaponLock.progress * 100)}% · ${lockTarget?.kind === 'tank' ? 'TANK' : 'AIR'}` : airWeapons.secondary === 'missile' ? 'HOLD RIGHT · LOCK & FIRE' : 'HOLD RIGHT · STRAIGHT ROCKETS';
      $('equipped-label').textContent = 'Aircraft weapons'; $('equipped-shortcut').hidden = true;
      $('equipped-toy').textContent = `LEFT · MACHINE GUN · ${craft.secondaryAmmo}/${airWeapons.capacity} ${airWeapons.secondary === 'missile' ? 'MISSILES' : 'ROCKETS'} · ${status}`;
      canvas.dataset.secondaryAmmo = String(craft.secondaryAmmo); canvas.dataset.weaponLock = weaponLock ? weaponLock.progress.toFixed(2) : 'none';
      lockMarker.textContent = weaponLock ? Math.floor(weaponLock.progress * 100) + '%' : '';
    } else { delete canvas.dataset.secondaryAmmo; delete canvas.dataset.weaponLock; }
    if (tank) {
      canvas.dataset.tankReload = tankReload.toFixed(2);
      canvas.dataset.tankTurretAngle = Number(game.current.tankGun?.turretAngle ?? game.current.turretAngle ?? game.current.angle).toFixed(3);
      canvas.dataset.tankGunPitch = Number(game.current.tankGun?.pitch ?? game.current.gunPitch ?? 0).toFixed(3);
    } else { delete canvas.dataset.tankReload; delete canvas.dataset.tankTurretAngle; delete canvas.dataset.tankGunPitch; }
    $('mouse-hint').hidden = !playActive() || mouseLocked();
    $('game-shell').classList.toggle('aiming', aiming);
    $('speed-value').textContent = game.player.vehicleId || train ? Math.round(Math.abs((train || game.current).speed || 0) * 3.6 / 20) + ' KM/H' : game.player.parachuting ? 'PARACHUTE' : fallen ? (fallen.phase === 'recover' ? 'GETTING UP' : 'WHOOPS!') : 'ON FOOT';
    $('speed-caption').textContent = flying ? (helicopter ? `${controlKey('climb')} climb · ${controlKey('descend')} descend` : `${controlKey(controlSettings.plane.preset === 'legacy' ? 'up' : 'throttleUp')} throttle up · ${controlKey(controlSettings.plane.preset === 'legacy' ? 'down' : 'throttleDown')} down`) : tank ? `${controlKey('up')} drive · MOUSE turret` : game.player.vehicleId ? (game.current.upright === false ? `${controlKey('recover')} · RIGHT THIS RIDE` : `${controlKey('boost')} boost · ${controlKey('brake')} drift`) : game.player.parachuting ? `${controlKey('up')} / ${controlKey('left')} / ${controlKey('down')} / ${controlKey('right')} steer` : fallen ? `${controlKey('recover')} · SKIP THE DRAMA` : `${controlKey('jump')} jump · ${controlKey('flop')} flop`;
    if (train) $('speed-caption').textContent = `${controlKey('interact')} hop off · ${controlKey('recover')} recover`;
    $('flight-panel').hidden = !flying;
    $('game-shell').classList.toggle('flying', flying);
    if (flying) {
      const aircraft = game.current, altitude = Math.max(0, aircraft.altitudeAGL ?? aircraft.agl ?? 0), throttle = clamp(aircraft.throttle || 0, 0, 1);
      $('flight-speed').textContent = Math.round(Math.abs(aircraft.speed || 0) * 3.6 / 20) + ' km/h';
      $('flight-altitude').textContent = Math.round(altitude) + ' m AGL';
      $('flight-throttle').textContent = Math.round(throttle * 100) + '%';
      $('flight-throttle-bar').style.width = throttle * 100 + '%';
      $('flight-phase').textContent = aircraftStatus(aircraft);
      const legacy = controlSettings.plane.preset === 'legacy';
      const warning = aircraft.stalled ? `STALL · ${controlKey(legacy ? 'up' : 'throttleUp')} throttle · ${controlKey(legacy ? 'descend' : 'pitchDown')} lower nose` : aircraft.stallWarning ? 'LOW AIRSPEED · increase throttle' : helicopter ? (altitude < 12 ? `Land gently · stop before pressing ${controlKey('interact')}` : `${controlKey('hover')} steadies your hover`) : aircraft.grounded ? `${controlKey(legacy ? 'up' : 'throttleUp')} throttle → ${controlKey(legacy ? 'climb' : 'pitchUp')} lift off` : altitude < 15 ? 'APPROACH · align runway, ease throttle' : `${controlKey(legacy ? 'left' : 'rollLeft')} / ${controlKey(legacy ? 'right' : 'rollRight')} bank · ${controlKey('bail')} parachute`;
      $('flight-warning').textContent = warning; $('flight-warning').dataset.danger = String(!!(aircraft.stalled || aircraft.stallWarning || aircraft.burning));
      canvas.dataset.aircraftType = aircraft.aircraftType; canvas.dataset.altitudeAgl = altitude.toFixed(2); canvas.dataset.throttle = throttle.toFixed(3); canvas.dataset.flightPhase = aircraft.flightPhase || aircraft.phase || '';
    } else { delete canvas.dataset.aircraftType; delete canvas.dataset.altitudeAgl; delete canvas.dataset.throttle; delete canvas.dataset.flightPhase; }
    const t = target();
    $('target-compass').hidden = !t;
    if (t) {
      const bearing = Math.atan2(t.y - game.current.y, t.x - game.current.x) - (scene?.viewYaw ?? game.current.angle);
      $('target-arrow').style.transform = 'rotate(' + Math.atan2(Math.sin(bearing), Math.cos(bearing)) * 180 / Math.PI + 'deg)';
      $('target-distance').textContent = Math.round(dist(t, game.current) / 20) + 'm';
      const targetGround = game.world.terrain?.surfaceHeight?.(t.x, t.y) || 0;
      $('target-altitude').textContent = Number.isFinite(t.elevation) ? 'TARGET ' + Math.round(Math.max(0, t.elevation - targetGround)) + 'm AGL' : Number.isFinite(t.altitude) ? 'ALT ' + Math.round(t.altitude) + 'm' : t.name || '';
    }
    $('cash').textContent = money(game.money); $('score').textContent = Math.round(game.score).toLocaleString(); $('best').textContent = Math.round(Math.max(game.bestScore || 0, game.score)).toLocaleString();
    const heatLevel = game.heatLevel;
    $('heat').textContent = '★'.repeat(heatLevel) + '☆'.repeat(MAX_HEAT - heatLevel);
    $('heat').setAttribute('aria-label', `Heat ${heatLevel} of ${MAX_HEAT}`);
    $('heat').dataset.level = heatLevel;
    const military = game.aviation.militaryStatus;
    const militaryActive = heatLevel === MAX_HEAT || military?.active || military?.phase === 'returning';
    const militaryType = military?.type === 'jet' ? 'JET INTERCEPTOR' : military?.type === 'helicopter' ? 'MILITARY HELICOPTER' : 'MILITARY RESPONSE';
    const militaryPhase = {
      warning: `SCRAMBLE IN ${Math.max(0, Math.ceil(game.aviation.militaryWarning || 0))}s`,
      launching: 'LAUNCHING', pursuit: 'ENGAGING', search: 'SEARCHING', returning: 'RETURNING TO BASE', unavailable: 'AWAITING REINFORCEMENT'
    }[military?.phase] || 'REQUESTED';
    $('military-status').hidden = !militaryActive;
    $('military-status').textContent = `${militaryType} · ${militaryPhase}`;
    $('military-status').dataset.phase = military?.phase || 'standby';
    $('military-status').dataset.response = military?.type || '';
    canvas.dataset.militaryResponse = military?.phase || 'standby';
    const armour = game.tankTraffic?.status;
    const buildUp = Math.max(0, Math.ceil(60 - (game.tankTraffic?.fourStarTime || 0)));
    let armourPhase = armour?.phase || 'standby';
    let armourText = {
      mobilising: `${armour?.reason === 'base-attack' ? 'BASE ALARM' : 'HEAVY ARMOUR'} · DISPATCH IN ${Math.max(0, Math.ceil(armour?.warning || 0))}s`,
      approach: 'HEAVY ARMOUR · EN ROUTE', pursuit: 'HEAVY ARMOUR · ENGAGING', search: 'HEAVY ARMOUR · SEARCHING',
      return: 'HEAVY ARMOUR · RETURNING TO BASE', blocked: 'HEAVY ARMOUR · HOLDING POSITION',
      unavailable: 'HEAVY ARMOUR · REFORMING', borrowed: 'HEAVY ARMOUR · RIDE BORROWED'
    }[armourPhase] || 'HEAVY ARMOUR · ON CALL';
    if (heatLevel === MAX_HEAT && armourPhase === 'standby' && buildUp > 0) {
      armourPhase = 'buildup'; armourText = `HEAVY ARMOUR · ESCALATION IN ${buildUp}s`;
    }
    $('tank-status').hidden = heatLevel < MAX_HEAT && !['mobilising', 'approach', 'pursuit', 'search', 'return', 'blocked'].includes(armourPhase);
    $('tank-status').textContent = armourText;
    $('tank-status').dataset.phase = armourPhase;
    $('tank-status').dataset.reason = armour?.reason || '';
    canvas.dataset.tankResponse = armourPhase;
    const transport=game.militaryTransport?.status,infantry=game.soldierTraffic?.status;
    const troopPhase=transport?.phase||'standby';
    const troopLabel={mobilising:`DISPATCH IN ${Math.max(0,Math.ceil(transport?.warning||0))}s`,approach:'CARRIER EN ROUTE',deployed:`${infantry?.deployed||0} SOLDIERS DEPLOYED`,reboard:'REBOARDING',return:'RETURNING TO BASE',blocked:'CARRIER HOLDING',borrowed:'CARRIER BORROWED',unavailable:'REFORMING'}[troopPhase]||(infantry?.phase==='engaged'?'BASE GUARDS ENGAGING':'ON CALL');
    $('troop-status').hidden=heatLevel<MAX_HEAT&&!['mobilising','approach','deployed','reboard','return','blocked'].includes(troopPhase);
    $('troop-status').textContent=`NORTHWATCH INFANTRY · ${troopLabel}`;
    $('troop-status').dataset.phase=troopPhase;canvas.dataset.troopResponse=troopPhase;
    canvas.dataset.soldiersDeployed=String(infantry?.deployed||0);
    $('composure-value').textContent = Math.round(game.player.composure) + '%';
    $('composure-bar').style.width = game.player.composure + '%';
    $('composure-meter')?.setAttribute('aria-valuenow', Math.round(game.player.composure));
    const car = game.player.vehicleId ? game.current : null;
    const condition = car ? (flying ? aircraftCondition(car) : VehicleStats.condition(car)) * 100 : 100;
    const rideName = train ? trainService.name : car ? vehicleName(car) : 'Fresh sneakers';
    $('ride-name').textContent = rideName; $('ride-name').title = rideName;
    $('ride-stats').hidden = !car && !train;
    $('ride-health').hidden = !car;
    $('ride-status').textContent = train ? 'Holding on · scheduled train' : car ? flying ? aircraftStatus(car) : VehicleStats.status(car) + (tank ? ' · ' + tankGunStatus : '') : game.player.parachuting ? 'Parachute · steer to a clear landing' : 'Ready for a stroll';
    if (train) $('ride-stats').textContent = trainService.leg === 'outbound' ? 'TO NORTHPORT · hop off before the map edge' : 'TO ' + trainService.destination.toUpperCase();
    $('ride-status').dataset.danger = Boolean(car?.burning);
    if (car) {
      const stats = flying ? aircraftModel(car) : VehicleStats.performance(car);
      $('ride-stats').textContent = flying ? (helicopter ? 'HELICOPTER' : 'FIXED WING') + ' · TOP ' + Math.round(stats.maxSpeed * 3.6 / 20) + ' km/h · ' + stats.seats + ' SEATS' : tank ? 'ARMOURED · TOP ' + Math.round(stats.maxSpeed * 3.6 / 20) + ' km/h · INDEPENDENT TURRET' : 'ACC ' + (stats.acceleration / 20).toFixed(1) + ' m/s² · TOP ' + Math.round(stats.maxSpeed * 3.6 / 20) + ' km/h · TURN ' + stats.handling.toFixed(1);
      $('ride-health').textContent = 'ENGINE ' + Math.round(flying ? car.engineHealth ?? 100 : stats.engineHealth) + '% · HANDLING ' + Math.round(flying ? car.handlingHealth ?? 100 : stats.handlingHealth) + '%';
    }
    $('ride-bar').style.width = condition + '%';
    $('ride-meter')?.setAttribute('aria-valuenow', Math.round(condition));
    $('ride-condition').textContent = car ? Math.round(condition) + '%' : '—';
    const mission = game.mission;
    $('objective-title').textContent = mission?.title || 'Your town. Your terrible ideas.';
    const objective = target();
    const aerialMission = mission && ['airtaxi', 'aircargo', 'sightseeing', 'airrace'].includes(mission.type);
    $('objective-detail').textContent = aerialMission ? (['airtaxi', 'aircargo'].includes(mission.type) ? 'HELICOPTER · ' + (objective?.name || 'Reach the marked pad') + '. Land and stop for 2 seconds.' : mission.type === 'sightseeing' && mission.targetIndex === mission.targets.length - 1 ? 'Return to the airport pad. Land and stop to finish.' : 'Fly through ' + (objective?.name || 'the elevated rings') + ' at the marked altitude.') : mission ? (mission.type === 'party' ? 'Drive to the ring. Press H to start the party.' : mission.stage === 'pickup' ? 'Reach the glowing ring to pick up the disco ball.' : mission.stage === 'dropoff' ? 'Deliver that disco ball to the glowing ring.' : 'Drive through the glowing rings in order.') : navigationTarget ? 'Follow the compass to '+navigationTarget.name+'. E borrows a parked vehicle or aircraft.' : 'Borrow a ride with E. Find aircraft at Meadows Airport or Northwatch Airbase beyond Pine Ridge.';
    $('mission-time').textContent = mission ? (mission.timeLeft > 0 ? Math.ceil(mission.timeLeft) + 's bonus' : 'OVERTIME · finish for base pay') : 'FREE ROAM';
    $('mission-progress').textContent = mission ? `${mission.targetIndex + 1}/${mission.targets.length} · ${Math.round(dist(objective, game.current) / 20)}m` + (mission.type === 'airtaxi' ? ` · COMFORT ${Math.round(game.missionStats.comfort ?? 100)}%` : '') : 'No rush. Cause a little joy.';
    $('mission-status').textContent = mission ? 'Gig in progress · base pay ' + money(mission.reward) : `${game.completed || 0} gigs delivered. Choose your next questionable errand.`;
    $('abandon-button').hidden = !mission;
    document.querySelectorAll('.contract-button').forEach(button => buttonState(button, mission ? 'Finish or abandon your current gig before starting another.' : ''));
    const nearest = game.services.find(s => dist(s, game.current) < (s.id === 'repair' ? 360 : 115));
    const insideRepairBay = game.insideRepairBay();
    $('garage-status').textContent = game.garageService ? 'Cool-Down Garage · servicing your ride…' : nearest ? (nearest.id === 'repair' ? (game.repairAvailable ? 'In the repair bay · E repairs and clears heat for $75.' : 'Cool-Down Garage · drive inside and stop for repairs.') : 'At the garage · G saves rides. I buys supplies.') : 'Sprinkle Garage: rides & supplies. Cool-Down Garage: repairs & heat relief.';
    $('boost-price').textContent = game.upgrades.boost >= 3 ? 'MAXED' : money(200 + game.upgrades.boost * 150);
    $('armor-price').textContent = game.upgrades.armor >= 3 ? 'MAXED' : money(150 + game.upgrades.armor * 125);
    document.querySelectorAll('.purchase-button').forEach(button => {
      const item = button.dataset.upgrade, level = game.upgrades[item];
      const price = item === 'repair' ? 45 : item === 'boost' ? 200 + level * 150 : 150 + level * 125;
      const reason = item !== 'repair' && level >= 3 ? 'This upgrade is already maxed out.' : !started ? 'Start playing, then visit Sprinkle Garage to buy tune-ups.' : !playActive() ? 'Resume playing and close any menus to buy tune-ups.' : !game.garageAvailable ? garageHint : item === 'repair' && !game.player.vehicleId ? 'Hop in a damaged car before buying a repair.' : item === 'repair' && !VehicleStats.isDamaged(game.current) ? 'This ride is already in perfect condition.' : game.money < price ? cashHint(price) : '';
      buttonState(button, reason);
    });
    let hint = nearest ? (nearest.id === 'repair' ? (game.repairAvailable ? `${controlKey('interact')} · repair & clear heat ($75)` : insideRepairBay ? 'Stop in the marked bay for repairs' : 'Drive into the open garage bay for repairs · $75') : 'G · garage collection   I · supplies & toys') : car ? `${controlKey('interact')} · hop out` : game.cars.some(c => dist(c, game.player) < 65) ? `${controlKey('interact')} · borrow this ride` : 'RIGHT MOUSE · aim   LEFT MOUSE · ' + GADGETS[game.inventory.equipped].name + '   TAB · toys';
    if (flying) hint = flightControlsHint(helicopter ? 'helicopter' : 'plane');
    else if (tank) hint = `${controlKey('up')} / ${controlKey('down')} drive · MOUSE turret · HOLD LEFT MOUSE cannon · ${controlKey('recover')} recover · ${controlKey('interact')} exit`;
    else if (car && !nearest) hint = `${controlKey('up')} / ${controlKey('down')} drive · ${controlKey('left')} / ${controlKey('right')} steer · ${controlKey('brake')} drift · ${controlKey('boost')} boost · ${controlKey('interact')} exit`;
    else if (!car && game.cars.some(ride => isTank(ride) && ride.health > 0 && !ride.exploded && dist(ride, game.player) < 65)) hint = `${controlKey('interact')} · borrow tank · MOUSE turret · HOLD LEFT MOUSE cannon`;
    else if (!car && (game.aircraft || []).some(aircraft => aircraft.active !== false && aircraft.visible !== false && aircraft.health > 0 && aircraft.grounded && MayhemAircraft.boardingDistance(aircraft,game.player)<65)) hint = `${controlKey('interact')} · borrow aircraft · Settings shows your flight controls`;
    if (game.hangarAvailable) hint += '   G · hangar';
    if (armedAircraft) hint = `LEFT · machine gun · HOLD RIGHT · ${airWeapons.secondary === 'missile' ? 'lock aircraft / tank & launch' : 'straight rockets (aim ahead)'} · stop at airfield to rearm`;
    if (flying && car.burning) hint = `ENGINE FIRE · ${controlKey('bail')} PARACHUTE · ${controlKey('recover')} airport recovery`;
    else if (!flying && car?.burning) hint = `ENGINE FIRE · ${Math.max(0, Math.ceil(8 - car.fireTime))}s · ${controlKey('interact')} BAIL OUT · stop + I for repair tape`;
    else if (car && car.engineHealth <= 0) hint = flying ? `ENGINE LOST · glide to land · ${controlKey('bail')} parachute · ${controlKey('recover')} airport recovery` : `ENGINE STALLED · stop + I for repair tape · ${controlKey('interact')} hop out`;
    else if (!flying && car?.upright === false) hint = `${controlKey('recover')} · right your ride and return to the road`;
    else if (!flying && car?.grounded === false) hint = `AIRBORNE!   ${controlKey('recover')} · recover to the road`;
    if (game.player.parachuting) hint = `PARACHUTE · ${controlKey('up')} / ${controlKey('left')} / ${controlKey('down')} / ${controlKey('right')} steer · ${controlKey('recover')} recover`;
    if (train) hint = `${controlKey('interact')} · hop off train   ${controlKey('recover')} · recover to road`;
    else if (!car && !fallen && !game.player.parachuting && game.railTraffic.boardingTarget(game.player)) hint = `${controlKey('interact')} · hop onto train side or rear`;
    $('interaction-hint').textContent = hint;
    if (fallen) $('interaction-hint').textContent = fallen.phase === 'recover' ? `Just finding my feet…  ${controlKey('recover')} · recover now` : `Oh, crumbs! Getting up shortly…  ${controlKey('recover')} · recover now`;
    $('interaction-hint').hidden = !started;
    if (game.heat > 0 && !fallen) {
      const chase = game.policeSeen ? (heatLevel === MAX_HEAT ? 'MILITARY & POLICE · CHASED' : 'FUN POLICE · CHASED') : `LAY LOW · ${Math.max(0, Math.ceil((game.escapeGoal || 8 + game.heat * 6) - game.escapeTimer))}s TO COOL`;
      $('interaction-hint').textContent = chase + '  /  ' + hint;
    }
  }
  let last = performance.now(), accumulator = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.12); last = now;
    if (started && !paused && !menuBusy() && !graphicsFailed && $('help-screen').hidden && !document.hidden) {
      accumulator += dt;
      const input = movementInput();
      if (!game.player.vehicleId) input.moveAngle = scene?.viewYaw ?? -Math.PI / 2;
      let count = 0;
      while (accumulator >= 1 / 60 && count++ < 8) {
        game.update(1 / 60, input);
        if (aiming && !game.physics?.get('player') && !game.player.vehicleId) {
          const direction = toyDirection(); game.player.angle = direction.angle; game.player.aimPitch = direction.pitch;
        }
        accumulator -= 1 / 60;
      }
      saveElapsed += dt;
      if (saveElapsed > 5) { save(); saveElapsed = 0; }
      events();
    } else accumulator = 0;
    updateAudio(dt);
    render(dt);
    hudElapsed += dt;
    if (hudElapsed > 0.1) { hud(); hudElapsed = 0; }
    if (now > toastUntil) $('toast').classList.remove('visible');
    requestAnimationFrame(frame);
  }
  hud(); requestAnimationFrame(frame);
})();
