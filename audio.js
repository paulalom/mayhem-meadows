(function (root) {
  'use strict';

  // Original radio arrangements and fallback effects are synthesized locally.
  // Optional generated effects decode from embedded bytes without a network.
  const STATIONS = Object.freeze([
    Object.freeze({ id: 'biscuit', name: 'Biscuit FM', genre: 'Disco funk' }),
    Object.freeze({ id: 'neon', name: 'Neon Drive', genre: 'Synthwave arcade' }),
    Object.freeze({ id: 'meadow', name: 'Meadow Waves', genre: 'Mellow dub' })
  ]);
  const DEFAULT_SETTINGS = Object.freeze({ masterVolume: 0.65, musicVolume: 0.45, effectsVolume: 0.8, radioStation: 'biscuit', muted: false });
  const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const midi = note => 440 * 2 ** ((note - 69) / 12);
  const VehicleStats = root.MayhemVehicleStats || (typeof require === 'function' ? require('./vehicle-stats.js') : null);
  const SAMPLE_KEYS = ['engine-compact', 'engine-sports', 'engine-van', 'engine-high-compact', 'engine-high-sports', 'engine-high-van', 'skid', 'siren', 'horn', 'crash', 'pop',
    'impact-light', 'impact-heavy', 'break-wood', 'break-metal', 'break-stone', 'break-foliage', 'explosion',
    'hammer', 'cannon-launch', 'cannon-burst', 'biscuit', 'tape', 'refill', 'door', 'splash', 'boost',
    'foot-pavement', 'foot-grass', 'foot-sand', 'ambience-coast', 'ambience-town', 'ambience-nature', 'ambience-docks', 'fire',
    'music-biscuit', 'music-neon', 'music-meadow', 'music-foot',
    'voice-resident-0', 'voice-resident-1', 'voice-resident-2', 'voice-resident-3', 'voice-resident-4',
    'voice-police-pursuit', 'voice-police-search', 'voice-radio-biscuit', 'voice-radio-neon', 'voice-radio-meadow'];
  const RESIDENT_LINES = ['SON OF A BISCUIT!', 'HECKITY HECK!', 'FLIPPIN’ TURNIPS!', 'OH, CRUMBS!', 'YOU ABSOLUTE WAFFLE!'];
  const DISTRICT_AMBIENCE = { riverfront: 'coast', works: 'docks', market: 'town', heights: 'town', willow: 'nature', ridge: 'nature', orchard: 'nature', marsh: 'coast' };
  const UI_EVENTS = new Set(['equip', 'purchase', 'biscuit', 'tape', 'refill', 'repair', 'paint', 'wash', 'menu-open', 'menu-close', 'menu-select']);
  const ENGINE_TYPES = {
    compact: { limit: 300, idle: 42, range: 100, cutoff: 700, wave: 'sawtooth' },
    sports: { limit: 370, idle: 58, range: 150, cutoff: 1100, wave: 'sawtooth' },
    van: { limit: 260, idle: 30, range: 70, cutoff: 480, wave: 'triangle' }
  };

  function normalizeSettings(value) {
    const saved = value && typeof value === 'object' ? value : {};
    const result = { ...DEFAULT_SETTINGS };
    for (const key of ['masterVolume', 'musicVolume', 'effectsVolume']) result[key] = clamp(finite(saved[key], result[key]), 0, 1);
    if (STATIONS.some(station => station.id === saved.radioStation) || saved.radioStation === 'off') result.radioStation = saved.radioStation;
    result.muted = typeof saved.muted === 'boolean' ? saved.muted : DEFAULT_SETTINGS.muted;
    return result;
  }

  function spatialAt(game, entity, yaw) {
    const player = game?.player || {}, listener = game?.cars?.find(car => car.id === player.vehicleId) || player;
    if (!Number.isFinite(entity?.x) || !Number.isFinite(entity?.y)) return { distance: 0, pan: 0, attenuation: 1 };
    const dx = entity.x - finite(listener.x), dy = entity.y - finite(listener.y), distance = Math.hypot(dx, dy);
    yaw = finite(yaw, finite(listener.angle));
    return { distance, pan: distance > 1 ? clamp((-dx * Math.sin(yaw) + dy * Math.cos(yaw)) / distance, -1, 1) : 0,
      attenuation: distance < 900 ? (1 - distance / 900) / (1 + (distance / 180) ** 2) : 0 };
  }

  function groundSurface(game, point) {
    const road = game?.network?.nearestRoad?.(point);
    if (road && road.distance <= finite(road.width, 104) / 2 + 32) return 'pavement';
    const district = game?.districtAt?.(point)?.id;
    const terrain = game?.terrain || game?.world?.terrain;
    const height = terrain?.heightAt?.(point.x, point.y);
    // Only low shoreline terrain is sand; marina sidewalks remain pavement.
    if ((district === 'riverfront' || district === 'marsh') && Number.isFinite(height) && height < 2.5) return 'sand';
    return road || district ? 'grass' : 'pavement';
  }

  // A pure model is also usable by diagnostics/tests without creating Web Audio.
  // Map x/y and speed use 20 units per metre, as in the vehicle physics engine.
  function deriveAudioFrame(game, options = {}) {
    const player = game?.player || {}, cars = Array.isArray(game?.cars) ? game.cars : [];
    const police = Array.isArray(game?.police) ? game.police : [];
    const vehicle = player.vehicleId ? cars.find(car => car.id === player.vehicleId) : null;
    const listener = vehicle || player, input = options.input || {};
    const yaw = finite(options.viewYaw, finite(listener.angle));
    const hasEngine = car => car && finite(car.health, 100) > 0 && finite(car.engineHealth, 100) > 0 && !car.exploded;
    const spatial = entity => spatialAt(game, entity, yaw);
    const engine = (car, controlled, location) => {
      const kind = ENGINE_TYPES[car.kind] ? car.kind : 'compact', type = ENGINE_TYPES[kind];
      const model = VehicleStats?.getModel ? VehicleStats.getModel(car) : root.MayhemCore?.CAR_TYPES?.[kind];
      const limit = clamp(finite(model?.maxSpeed, type.limit), 1, 1000);
      const speed = clamp(Math.abs(finite(car.speed)), 0, limit * 1.7), ratio = speed / limit;
      const throttle = controlled ? (input.up || input.down && finite(car.speed) < 15 ? 1 : 0.18) : clamp(ratio * 1.3 + 0.18, 0.18, 0.85);
      const gear = Math.min(3, Math.floor(ratio * 4));
      const rev = clamp((ratio * 4 - gear) * 0.6 + throttle * 0.3 + (controlled && input.boost ? 0.16 : 0), 0, 1.2);
      const damage = 1 - clamp(finite(car.engineHealth, 100) / 100, 0, 1);
      return { id: String(car.id), kind, controlled, speed, throttle, gear, damage, frequency: type.idle + type.range * rev,
        cutoff: type.cutoff + 1500 * rev, gain: (controlled ? 0.115 : 0.06 * location.attenuation) * (0.65 + throttle * 0.35),
        pan: controlled ? 0 : location.pan, distance: controlled ? 0 : location.distance };
    };
    const nearby = cars.filter(car => hasEngine(car) && car.id !== vehicle?.id && car.traffic)
      .concat(police.filter(hasEngine)).map(car => ({ car, location: spatial(car) }))
      .filter(item => item.location.attenuation > 0.004).sort((a, b) => a.location.distance - b.location.distance).slice(0, 4);
    const engines = nearby.map(item => engine(item.car, false, item.location));
    if (hasEngine(vehicle)) engines.unshift(engine(vehicle, true, {}));
    const heat = clamp(finite(game?.heat), 0, 3);
    const sirens = heat > 0 ? police.filter(cop => hasEngine(cop) && !cop.burning).map(cop => ({ id: String(cop.id), ...spatial(cop) }))
      .filter(cop => cop.attenuation > 0.004).sort((a, b) => a.distance - b.distance).slice(0, 3)
      .map(cop => ({ ...cop, gain: cop.attenuation * 0.095, rate: heat > 1 ? 1.45 : 0.65 })) : [];
    let skid = 0, road = 0, boost = 0;
    if (vehicle) {
      const angle = finite(vehicle.angle), lateral = Math.abs(-finite(vehicle.vx) * Math.sin(angle) + finite(vehicle.vy) * Math.cos(angle));
      const speed = Math.abs(finite(vehicle.speed));
      const terrain = game?.terrain || game?.world?.terrain, ground = terrain?.surfaceHeight?.(vehicle.x, vehicle.y);
      const grounded = vehicle.upright !== false && (typeof vehicle.grounded === 'boolean' ? vehicle.grounded : !Number.isFinite(ground) || Math.abs(finite(vehicle.elevation, ground) - ground) < 0.2);
      skid = grounded && speed > 35 ? clamp((input.brake ? speed / 250 : lateral / 140) * 0.11, 0, 0.11) : 0;
      road = grounded ? clamp(speed / 370, 0, 1.3) * 0.038 : 0;
      boost = grounded && input.boost && input.up ? 0.038 : 0;
    }
    const walking = !vehicle && player.grounded !== false && finite(player.stunned) <= 0 &&
      !(game?.ragdolls?.get && game.ragdolls.get(player.id)) && !!(input.up || input.down || input.left || input.right);
    const fires = cars.concat(police).filter(car => car.burning && !car.exploded).map(car => ({ id: String(car.id), ...spatial(car) }))
      .filter(car => car.attenuation > 0.01).sort((a, b) => a.distance - b.distance).slice(0, 3);
    const district = game?.districtAt?.(listener)?.id;
    return { mode: vehicle ? 'vehicle' : 'foot', engines, sirens, skid, road, boost, walking, running: !!input.boost,
      surface: groundSurface(game, listener), ambience: DISTRICT_AMBIENCE[district] || null, fires,
      warning: vehicle?.burning && !vehicle.exploded ? { id: String(vehicle.id), progress: clamp(finite(vehicle.fireTime) / 8, 0, 1) } : null };
  }

  class AudioDirector {
    constructor(options = {}) {
      this.settings = normalizeSettings(options.settings);
      this._factory = options.contextFactory || (() => {
        const Context = root.AudioContext || root.webkitAudioContext;
        return Context ? new Context({ latencyHint: 'interactive' }) : null;
      });
      this._context = null; this._state = 'locked'; this._active = false; this._disposed = false;
      this._voices = new Set(); this._engines = new Map(); this._sirens = new Map(); this._noiseLoops = new Map();
      this._musicKey = null; this._step = 0; this._nextNote = 0; this._footstep = 0; this._mode = 'idle';
      this._noise = null; this._lastEvent = new Map(); this._error = null;
      this._environment = new Map(); this._duckUntil = 0; this._warningAt = 0; this._warningId = null;
      this._viewYaw = 0; this._variation = 0; this._lastSpeech = -20; this._stationLast = new Map(); this._stationAt = Infinity;
      this._musicGenerated = false; this._nextMusicAt = 0; this._lastPlayedSample = null; this._lastPlayedEvent = null;
      this._uiAllowed = false; this._uiPlaying = false;
      this._boosting = false; this._boostAt = -10; this._speechLast = new Map(); this._pendingSearch = null;
      this._failed = false; this._ready = false; this._pendingNodes = new Set(); this._lastFootPosition = null;
      this._sampleData = options.sampleData === undefined ? root.MayhemAudioSamples || {} : options.sampleData || {};
      this._samples = new Map(); this._loadingSamples = new Set(); this._failedSamples = new Set(); this._requestedSamples = new Set();
    }

    async unlock() {
      if (this._disposed) return false;
      try {
        if (!this._context) {
          const context = this._factory();
          if (!context) { this._state = 'unavailable'; return false; }
          this._context = context;
        }
        if (!this._ready) {
          const context = this._context;
          this._master = this._node('createGain'); this._master.gain.value = 0;
          this._music = this._node('createGain'); this._effects = this._node('createGain');
          this._limiter = this._node('createDynamicsCompressor');
          this._limiter.threshold.value = -14; this._limiter.knee.value = 10;
          this._limiter.ratio.value = 8; this._limiter.attack.value = 0.003; this._limiter.release.value = 0.2;
          this._music.connect(this._master); this._effects.connect(this._master);
          this._master.connect(this._limiter); this._limiter.connect(context.destination);
          this._noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
          const data = this._noise.getChannelData(0);
          // Repeatable white noise; loop ends are crossfaded to avoid a seam.
          let seed = 1737;
          for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = (seed / 4294967296 * 2 - 1) * 0.8; }
          const seam = Math.min(256, Math.floor(data.length / 4));
          for (let i = 0; i < seam; i++) data[data.length - seam + i] = data[data.length - seam + i] * (1 - i / seam) + data[i] * (i / seam);
          this._pendingNodes.clear(); this._ready = true;
        }
        if (this._context.state === 'suspended') await this._context.resume();
        this._state = this._context.state || 'running';
        this._failed = false; this._error = null;
        this._applyVolumes();
        this._loadSamples();
        return this._state === 'running';
      } catch (error) { this._fail(error); return false; }
    }

    setSettings(settings) {
      const old = this.settings;
      this.settings = normalizeSettings({ ...old, ...(settings && typeof settings === 'object' ? settings : {}) });
      try {
        if (old.radioStation !== this.settings.radioStation || this.settings.musicVolume === 0) this._cancelMusic();
        if (this.settings.effectsVolume === 0) this._stopEffects();
        if (this.settings.muted || this.settings.masterVolume === 0) this._silence();
        this._applyVolumes();
      } catch (error) { this._fail(error); }
      return { ...this.settings };
    }

    update(game, options = {}) {
      try {
        if (this._failed) { this._silence(); return; }
        const running = this._context && this._context.state === 'running';
        this._state = this._disposed ? 'disposed' : this._context ? this._context.state : this._state;
        const active = options.active !== false && running && !this.settings.muted && this.settings.masterVolume > 0 && !this._disposed;
        if (!active) { this._silence(options.allowUI === true && running && !this.settings.muted && this.settings.masterVolume > 0 && this.settings.effectsVolume > 0 && !this._disposed); return; }
        this._uiAllowed = false;
        this._active = true;
        const frame = deriveAudioFrame(game, options); this._mode = frame.mode; this._viewYaw = finite(options.viewYaw, finite(game?.current?.angle));
        this._applyVolumes();
        if (this.settings.effectsVolume > 0) {
          this._syncEngines(frame.engines); this._syncSirens(frame.sirens);
          this._syncNoise('skid', frame.skid, 1600, 'bandpass', 1.5);
          this._syncNoise('road', frame.road, frame.surface === 'grass' ? 700 : frame.surface === 'sand' ? 950 : 450, 'lowpass', 0.7);
          this._syncNoise('boost', frame.boost, 2100, 'bandpass', 0.6);
          if (frame.boost > 0 && this._boosting === false && this._context.currentTime - this._boostAt > 1.2) {
            const burst = this._sampleVoice('boost', { level: 0.075, duration: 0.8 });
            if (burst) { this._boostAt = this._context.currentTime; this._lastPlayedSample = 'boost'; this._lastPlayedEvent = 'boost'; }
          }
          this._boosting = frame.boost > 0;
          this._syncEnvironment(frame);
          this._updateWarning(frame.warning);
          this._flushSpeech(game);
          this._updateFootsteps(game, frame, options.dt);
        } else this._stopEffects();
        const key = frame.mode === 'vehicle' ? this.settings.radioStation : 'foot';
        this._scheduleMusic(this.settings.musicVolume > 0 ? key : 'off');
        this._prune();
      } catch (error) { this._fail(error); }
    }

    get diagnostics() {
      return { state: this._disposed ? 'disposed' : this._state, active: this._active, mode: this._mode,
        station: this._musicKey || 'off', engineCount: this._engines.size, sirenCount: this._sirens.size,
        voiceCount: this._voices.size, musicVoiceCount: [...this._voices].filter(voice => voice.bus === 'music').length,
        sampleCount: this._samples.size, loadingSamples: this._loadingSamples.size, failedSamples: this._failedSamples.size,
        generatedVoiceCount: [...this._voices].filter(voice => voice.generated).length,
        ambienceCount: [...this._environment.values()].filter(voice => voice.environment === 'ambience').length,
        fireCount: [...this._environment.values()].filter(voice => voice.environment === 'fire').length,
        speechCount: [...this._voices].filter(voice => voice.speech).length,
        oneShotCount: [...this._voices].filter(voice => voice.generated && voice.bus === 'effects' && Number.isFinite(voice.end) && !voice.speech).length,
        lastPlayedSample: this._lastPlayedSample, lastPlayedEvent: this._lastPlayedEvent,
        engineSampleCount: [...this._engines.values()].filter(voice => voice.generated).length,
        sirenSampleCount: [...this._sirens.values()].filter(voice => voice.generated).length,
        muted: this.settings.muted, error: this._error };
    }
    getStatus() { return this.diagnostics; }

    _loadSamples() {
      const context = this._context;
      for (const key of SAMPLE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(this._sampleData, key) || this._requestedSamples.has(key)) continue;
        this._requestedSamples.add(key); this._loadingSamples.add(key);
        // Decode completion only fills the cache. It cannot revive a paused,
        // muted, disposed, or otherwise changed game state.
        Promise.resolve().then(() => {
          const asset = this._sampleData[key];
          if (!asset || typeof asset.data !== 'string' || !asset.data.length || asset.data.length > 8 * 1024 * 1024) throw new Error('Invalid embedded audio');
          const binary = root.atob(asset.data), bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return context.decodeAudioData(bytes.buffer);
        }).then(buffer => {
          if (this._disposed || this._context !== context) return;
          if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > (key.startsWith('music-') ? 180 : 60) || !buffer.numberOfChannels) throw new Error('Invalid decoded audio');
          const asset = this._sampleData[key], loop = asset.loop === true;
          let peak = 0, power = 0, count = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < data.length; i++) { if (!Number.isFinite(data[i])) data[i] = 0; peak = Math.max(peak, Math.abs(data[i])); power += data[i] * data[i]; count++; }
          }
          if (peak < 0.00001) throw new Error('Silent decoded audio');
          // Quiet generated foley should remain audible beside the radio. Cap
          // boosts so a weak recording never turns into amplified noise.
          const ambient = key.startsWith('ambience-'), rms = Math.sqrt(power / Math.max(1, count));
          const scale = ambient ? Math.min(0.6 / peak, 12, 0.16 / Math.max(rms, 0.0001)) : Math.min(0.9 / peak, 3, 0.75 / peak);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel), fade = Math.min(Math.floor(buffer.sampleRate * 0.005), Math.floor(data.length / 4));
            for (let i = 0; i < data.length; i++) data[i] *= scale;
            if (loop && !key.startsWith('music-')) for (let i = 0; i < fade; i++) { data[i] *= i / fade; data[data.length - 1 - i] *= i / fade; }
          }
          this._samples.set(key, { buffer, loop, gain: clamp(finite(asset.gain, 1), 0, 1), baseFrequency: clamp(finite(asset.baseFrequency, 80), 20, 1000) });
        }).catch(() => { if (!this._disposed) this._failedSamples.add(key); })
          .finally(() => this._loadingSamples.delete(key));
      }
    }

    _sampleVoice(key, options = {}) {
      const sample = this._samples.get(key);
      const bus = options.bus === 'music' ? 'music' : 'effects';
      if (!sample || !this._hasRoom(bus)) return null;
      const now = Math.max(this._context.currentTime, finite(options.start, this._context.currentTime)), loop = options.loop === true;
      if (loop && !sample.loop) return null;
      const source = this._node('createBufferSource'); source.buffer = sample.buffer; source.loop = loop;
      const rate = clamp(finite(options.rate, 1), 0.5, 2.5); source.playbackRate.value = rate;
      const gain = this._node('createGain'); gain.gain.value = 0;
      source.connect(gain);
      const pan = this._output(gain, options.pan, bus === 'music' ? this._music : this._effects);
      const duration = Math.min(sample.buffer.duration / rate, clamp(finite(options.duration, sample.buffer.duration / rate), 0.02, bus === 'music' ? 180 : options.speech ? 8 : 3));
      const end = loop ? Infinity : now + duration + 0.01;
      const record = this._record([source], [source, gain, ...(pan ? [pan] : [])], gain, bus, end);
      record.generated = true; record.sampleKey = key; record.sample = sample; record.main = source; record.pan = pan;
      record.speech = options.speech === true;
      record.priority = finite(options.priority);
      if (!loop) {
        const level = clamp(finite(options.level, 0.15), 0, 0.3) * sample.gain;
        const fade = Math.min(finite(options.fade, 0.008), duration / 4);
        gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(level, now + fade);
        gain.gain.setValueAtTime(level, now + Math.max(duration / 2, duration - Math.max(fade, 0.045)));
        gain.gain.linearRampToValueAtTime(0, now + duration);
      }
      source.start(now); if (!loop) source.stop(end);
      return record;
    }

    _hasRoom(bus) {
      return this._voices.size < 80 && [...this._voices].filter(voice => voice.bus === bus).length < 48;
    }

    _reserveEffects(count = 1) {
      const candidates = [...this._voices].filter(voice => voice.bus === 'effects' && Number.isFinite(voice.end) && !voice.speech && finite(voice.priority) < 2)
        .sort((a, b) => finite(a.priority) - finite(b.priority) || a.end - b.end);
      const available = () => this._voices.size <= 80 - count && [...this._voices].filter(voice => voice.bus === 'effects').length <= 48 - count;
      while (!available() && candidates.length) this._stop(candidates.shift());
      return available();
    }

    _duck(duration = 1) {
      this._duckUntil = Math.max(this._duckUntil, this._context.currentTime + duration);
      this._applyVolumes();
    }

    _say(key, location = { attenuation: 1, pan: 0 }, cooldown = 3) {
      const now = this._context.currentTime;
      if (!this._samples.has(key) || location.attenuation < 0.04 || now - (this._speechLast.get(key) ?? -100) < cooldown) return false;
      const priority = key === 'voice-police-pursuit' ? 3 : key === 'voice-police-search' ? 2 : 1;
      const existing = [...this._voices].filter(voice => voice.speech);
      if (existing.length) {
        if (priority < 2 || existing.some(voice => (voice.priority || 1) >= priority)) return false;
        for (const voice of existing) this._stop(voice);
      }
      if (priority < 2 && now - this._lastSpeech < (key.startsWith('voice-resident-') ? 2.8 : 8)) return false;
      if (priority >= 2 && !this._reserveEffects()) return false;
      const record = this._sampleVoice(key, { speech: true, level: 0.23 * location.attenuation, pan: location.pan });
      if (!record) return false;
      record.priority = priority;
      this._lastSpeech = now; this._speechLast.set(key, now); this._lastPlayedSample = key;
      this._duck(Math.min(8, record.end - now) + 0.3); return true;
    }

    _flushSpeech(game) {
      const pending = this._pendingSearch;
      if (!pending) return;
      if (!(finite(game?.heat) > 0) || game.policeSeen === true || game._policeSearching !== true || this._context.currentTime - pending.at > 12) { this._pendingSearch = null; return; }
      if (this._say('voice-police-search', pending.location, 10)) { this._lastPlayedEvent = 'search'; this._pendingSearch = null; }
    }

    _ramp(param, value, duration = 0.035) {
      if (!param || !this._context) return;
      const now = this._context.currentTime;
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
      else { param.cancelScheduledValues(now); param.setValueAtTime(finite(param.value), now); }
      param.linearRampToValueAtTime(finite(value), now + duration);
    }
    _applyVolumes() {
      if (!this._context || !this._master) return;
      const audible = this._active || this._uiAllowed && [...this._voices].some(voice => voice.ui);
      this._ramp(this._master.gain, audible && !this.settings.muted ? this.settings.masterVolume : 0);
      this._ramp(this._music.gain, this.settings.musicVolume * (this._context.currentTime < this._duckUntil ? 0.36 : 1), 0.12);
      this._ramp(this._effects.gain, this.settings.effectsVolume);
    }
    _record(sources, nodes, gain, bus, end = Infinity) {
      const record = { sources, nodes, gain, bus, end, stopped: false, ui: this._uiPlaying && bus === 'effects' };
      for (const node of nodes) this._pendingNodes.delete(node);
      this._voices.add(record);
      let remaining = sources.length;
      for (const source of sources) source.onended = () => { if (--remaining <= 0) this._clean(record); };
      return record;
    }
    _clean(record) {
      this._voices.delete(record);
      for (const node of record.nodes) { try { node.disconnect(); } catch (_) {} }
    }
    _stop(record, immediate = false) {
      if (!record || record.stopped) return;
      record.stopped = true;
      const now = this._context.currentTime, end = now + (immediate ? 0 : 0.02);
      try { this._ramp(record.gain.gain, 0, immediate ? 0 : 0.015); } catch (_) {}
      let partial = false;
      for (const source of record.sources) { try { source.stop(end); } catch (_) { partial = true; } }
      if (partial) this._clean(record);
      this._voices.delete(record);
    }
    _cancelMusic() {
      for (const record of this._voices) if (record.bus === 'music') this._stop(record);
      this._musicKey = null; this._step = 0; this._nextNote = 0;
      this._musicGenerated = false; this._nextMusicAt = 0; this._stationAt = Infinity;
    }
    _stopEffects(preserveUI = false) {
      for (const record of this._voices) if (record.bus === 'effects' && !(preserveUI && record.ui)) this._stop(record);
      this._engines.clear(); this._sirens.clear(); this._noiseLoops.clear();
      this._environment.clear(); this._warningId = null; this._warningAt = 0;
      // A held boost after resume establishes state without another attack.
      this._boosting = null; this._pendingSearch = null;
      this._lastFootPosition = null;
    }
    _silence(preserveUI = false) {
      this._active = false; this._mode = 'idle'; this._footstep = 0; this._duckUntil = 0;
      this._uiAllowed = preserveUI;
      if (!this._context) return;
      try { this._ramp(this._master?.gain, 0, 0.015); } catch (_) {}
      this._cancelMusic(); this._stopEffects(preserveUI); this._applyVolumes();
    }
    _node(method) {
      const node = this._context[method](); this._pendingNodes.add(node); return node;
    }
    _fail(error) {
      this._failed = true; this._error = String(error?.message || error); this._state = 'unavailable'; this._silence();
      // A factory/connect failure can occur before a voice owns its nodes.
      // Retire that partial graph, and retry only after another unlock gesture.
      for (const node of this._pendingNodes) {
        try { node.stop?.(); } catch (_) {}
        try { node.disconnect(); } catch (_) {}
      }
      this._pendingNodes.clear();
    }
    _prune() {
      const now = this._context.currentTime;
      for (const record of this._voices) if (record.end < now - 0.1) this._clean(record);
    }
    _output(gain, pan, bus) {
      let panner = null;
      if (this._context.createStereoPanner) { panner = this._node('createStereoPanner'); panner.pan.value = clamp(finite(pan), -1, 1); gain.connect(panner); panner.connect(bus); }
      else gain.connect(bus);
      return panner;
    }

    _engine(description) {
      if (!this._hasRoom('effects')) return null;
      const type = ENGINE_TYPES[description.kind];
      const gain = this._node('createGain'); gain.gain.value = 0;
      const filter = this._node('createBiquadFilter'); filter.type = 'lowpass'; filter.frequency.value = description.cutoff; filter.Q.value = 0.6;
      const main = this._node('createOscillator'); main.type = type.wave; main.frequency.value = description.frequency;
      const sub = this._node('createOscillator'); sub.type = 'sine'; sub.frequency.value = description.frequency * 0.5;
      const subGain = this._node('createGain'); subGain.gain.value = 0.55;
      const intake = this._node('createBufferSource'); intake.buffer = this._noise; intake.loop = true;
      const intakeGain = this._node('createGain'); intakeGain.gain.value = 0.12;
      main.connect(filter); sub.connect(subGain); subGain.connect(filter); intake.connect(intakeGain); intakeGain.connect(filter); filter.connect(gain);
      const pan = this._output(gain, description.pan, this._effects);
      const record = this._record([main, sub, intake], [main, sub, subGain, intake, intakeGain, filter, gain, ...(pan ? [pan] : [])], gain, 'effects');
      record.main = main; record.sub = sub; record.filter = filter; record.pan = pan; record.kind = description.kind; record.intakeGain = intakeGain;
      main.start(); sub.start(); intake.start(); return record;
    }
    _addLoadedEngine(record, kind) {
      const sample = this._samples.get('engine-high-' + kind);
      if (!sample?.loop) return;
      const lowGain = this._node('createGain'), highGain = this._node('createGain');
      lowGain.gain.value = 1; highGain.gain.value = 0;
      record.main.disconnect(); record.main.connect(lowGain); lowGain.connect(record.gain);
      const high = this._node('createBufferSource'); high.buffer = sample.buffer; high.loop = true; high.connect(highGain); highGain.connect(record.gain);
      record.sources.push(high); record.nodes.push(lowGain, highGain, high);
      for (const node of [lowGain, highGain, high]) this._pendingNodes.delete(node);
      let remaining = record.sources.length;
      for (const source of record.sources) source.onended = () => { if (--remaining <= 0) this._clean(record); };
      record.lowGain = lowGain; record.highGain = highGain; record.high = high; record.highSample = sample; high.start();
    }
    _syncEngines(descriptions) {
      const wanted = new Set(descriptions.map(item => item.id));
      for (const [id, record] of this._engines) if (!wanted.has(id)) { this._stop(record); this._engines.delete(id); }
      for (const [id, record] of this._noiseLoops) if (id.startsWith('rattle-') && !wanted.has(id.slice(7))) { this._stop(record); this._noiseLoops.delete(id); }
      for (const item of descriptions) {
        let record = this._engines.get(item.id);
        const key = 'engine-' + item.kind, sample = this._samples.get(key), generated = !!sample?.loop;
        if (record && (record.kind !== item.kind || !!record.generated !== generated)) { this._stop(record); record = null; }
        if (!record) {
          record = generated ? this._sampleVoice(key, { loop: true, pan: item.pan, rate: item.frequency / sample.baseFrequency }) : this._engine(item);
          if (!record) { this._engines.delete(item.id); continue; }
          if (generated) this._addLoadedEngine(record, item.kind);
          record.kind = item.kind; this._engines.set(item.id, record);
        }
        if (record.generated && !record.high) this._addLoadedEngine(record, item.kind);
        const now = this._context.currentTime;
        // A worn engine has a quiet irregular cough; avoid dropping clean
        // engines in volume on every frame or changing pitch discontinuously.
        const cough = item.damage > 0.35 ? 1 - item.damage * 0.25 * Math.max(0, Math.sin(now * 13.7) * Math.sin(now * 5.3)) : 1;
        this._ramp(record.gain.gain, item.gain * cough * (record.sample?.gain ?? 1), 0.06);
        if (record.generated) {
          const rev = clamp((item.frequency - ENGINE_TYPES[item.kind].idle) / ENGINE_TYPES[item.kind].range, 0, 1.2);
          this._ramp(record.main.playbackRate, clamp(item.frequency / record.sample.baseFrequency, record.high ? 0.75 : 0.5, record.high ? 1.65 : 2.5), 0.1);
          if (record.high) {
            const blend = clamp(rev * 0.7 + item.throttle * 0.2, 0, 0.95);
            this._ramp(record.lowGain.gain, Math.cos(blend * Math.PI / 2), 0.09);
            this._ramp(record.highGain.gain, Math.sin(blend * Math.PI / 2) * record.highSample.gain, 0.09);
            this._ramp(record.high.playbackRate, 0.85 + rev * 0.3, 0.1);
          }
        }
        else {
          this._ramp(record.main.frequency, item.frequency, 0.08);
          this._ramp(record.sub.frequency, item.frequency * 0.5, 0.08); this._ramp(record.filter.frequency, item.cutoff, 0.08);
          this._ramp(record.intakeGain.gain, 0.07 + item.throttle * 0.07 + item.damage * 0.12, 0.08);
        }
        if (record.gear !== undefined && record.gear !== item.gear && item.controlled && item.speed > 40) this._noiseHit(now, 0.055, 0.02, 450, 'lowpass', 'effects');
        record.gear = item.gear;
        this._syncNoise('rattle-' + item.id, item.damage > 0.25 ? item.gain * item.damage * (0.07 + 0.09 * Math.abs(Math.sin(now * 17))) : 0, 1100, 'bandpass', 2, item.pan);
        if (record.pan) this._ramp(record.pan.pan, item.pan, 0.06);
      }
    }
    _siren(item) {
      if (!this._hasRoom('effects')) return null;
      const gain = this._node('createGain'); gain.gain.value = 0;
      const carrier = this._node('createOscillator'); carrier.type = 'triangle'; carrier.frequency.value = 780;
      const upper = this._node('createOscillator'); upper.type = 'sine'; upper.frequency.value = 1560;
      const upperGain = this._node('createGain'); upperGain.gain.value = 0.17;
      const lfo = this._node('createOscillator'); lfo.type = 'sine'; lfo.frequency.value = item.rate;
      const sweep = this._node('createGain'); sweep.gain.value = 290;
      const upperSweep = this._node('createGain'); upperSweep.gain.value = 580;
      lfo.connect(sweep); sweep.connect(carrier.frequency); lfo.connect(upperSweep); upperSweep.connect(upper.frequency);
      carrier.connect(gain); upper.connect(upperGain); upperGain.connect(gain);
      const pan = this._output(gain, item.pan, this._effects);
      const record = this._record([carrier, upper, lfo], [carrier, upper, upperGain, lfo, sweep, upperSweep, gain, ...(pan ? [pan] : [])], gain, 'effects');
      record.pan = pan; record.lfo = lfo;
      carrier.start(); upper.start(); lfo.start(); return record;
    }
    _syncSirens(descriptions) {
      const wanted = new Set(descriptions.map(item => item.id));
      for (const [id, record] of this._sirens) if (!wanted.has(id)) { this._stop(record); this._sirens.delete(id); }
      for (const item of descriptions) {
        let record = this._sirens.get(item.id);
        const generated = !!this._samples.get('siren')?.loop;
        if (record && !!record.generated !== generated) { this._stop(record); record = null; }
        if (!record) {
          record = generated ? this._sampleVoice('siren', { loop: true, pan: item.pan, rate: 0.88 + item.rate * 0.2 }) : this._siren(item);
          if (!record) { this._sirens.delete(item.id); continue; }
          this._sirens.set(item.id, record);
        }
        this._ramp(record.gain.gain, item.gain * (record.sample?.gain ?? 1), 0.05);
        if (record.generated) this._ramp(record.main.playbackRate, clamp(0.88 + item.rate * 0.2, 0.5, 2.5), 0.08);
        else this._ramp(record.lfo.frequency, item.rate, 0.08);
        if (record.pan) this._ramp(record.pan.pan, item.pan, 0.06);
      }
    }
    _syncNoise(id, level, frequency, type, q, pan = 0) {
      let record = this._noiseLoops.get(id);
      if (level < 0.001) { if (record) { this._stop(record); this._noiseLoops.delete(id); } return; }
      const generated = id === 'skid' && !!this._samples.get('skid')?.loop;
      if (record && !!record.generated !== generated) { this._stop(record); record = null; }
      if (!record) {
        if (generated) record = this._sampleVoice('skid', { loop: true });
        else record = this._noiseLoop(frequency, type, q, pan);
        if (!record) return;
        this._noiseLoops.set(id, record);
      }
      this._ramp(record.gain.gain, level * (record.sample?.gain ?? 1), 0.05);
      if (record.filter) this._ramp(record.filter.frequency, frequency, 0.08);
      if (record.pan) this._ramp(record.pan.pan, pan, 0.06);
    }

    _noiseLoop(frequency, type, q, pan = 0) {
      if (!this._hasRoom('effects')) return null;
      const source = this._node('createBufferSource'); source.buffer = this._noise; source.loop = true;
      const filter = this._node('createBiquadFilter'); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
      const gain = this._node('createGain'); gain.gain.value = 0; source.connect(filter); filter.connect(gain);
      const panner = this._output(gain, pan, this._effects);
      const record = this._record([source], [source, filter, gain, ...(panner ? [panner] : [])], gain, 'effects');
      record.filter = filter; record.pan = panner; source.start(); return record;
    }

    _syncEnvironment(frame) {
      const descriptions = frame.fires.map(fire => ({ id: 'fire-' + fire.id, key: 'fire', environment: 'fire', level: 0.052 * fire.attenuation, pan: fire.pan }));
      if (frame.ambience) descriptions.push({ id: 'ambience', key: 'ambience-' + frame.ambience, environment: 'ambience', level: frame.mode === 'vehicle' ? 0.035 : 0.065, pan: 0 });
      const wanted = new Set(descriptions.map(item => item.id));
      for (const [id, record] of this._environment) if (!wanted.has(id)) { this._stop(record); this._environment.delete(id); }
      for (const item of descriptions) {
        const generated = !!this._samples.get(item.key)?.loop;
        let record = this._environment.get(item.id);
        if (record && (record.environmentKey !== item.key || !!record.generated !== generated)) { this._stop(record); record = null; }
        if (!record) {
          // Wind/water/fire have restrained noise fallbacks. Traffic and bird
          // calls need real recordings; avoid an artificial constant hiss.
          if (!generated && item.key === 'ambience-town') { this._environment.delete(item.id); continue; }
          record = generated ? this._sampleVoice(item.key, { loop: true, pan: item.pan }) : this._noiseLoop(item.environment === 'fire' ? 1200 : 480, 'lowpass', 0.4, item.pan);
          if (!record) continue;
          record.environmentKey = item.key; record.environment = item.environment; this._environment.set(item.id, record);
        }
        const swell = 0.85 + 0.15 * Math.sin(this._context.currentTime * (item.environment === 'fire' ? 5.7 : 0.6));
        this._ramp(record.gain.gain, item.level * swell * (record.sample?.gain ?? 0.45), 0.4);
        if (record.pan) this._ramp(record.pan.pan, item.pan, 0.06);
      }
    }

    _updateWarning(warning) {
      if (!warning) { this._warningId = null; this._warningAt = 0; return; }
      const now = this._context.currentTime;
      if (this._warningId !== warning.id) { this._warningId = warning.id; this._warningAt = now; }
      if (now < this._warningAt) return;
      if (!this._reserveEffects(2)) return;
      const urgent = warning.progress > 0.7;
      this._tone(urgent ? 880 : 660, now, 0.095, 0.075, 'sine', 'effects', { priority: 2 });
      this._tone(urgent ? 660 : 440, now + 0.12, 0.085, 0.055, 'sine', 'effects', { priority: 2 });
      this._warningAt = now + 1.3 - warning.progress * 1.05; this._duck(0.35);
    }

    _tone(frequency, start, duration, level, wave = 'sine', bus = 'music', options = {}) {
      if (!this._hasRoom(bus) || !frequency || level <= 0) return;
      const source = this._node('createOscillator'); source.type = wave;
      source.frequency.setValueAtTime(clamp(frequency, 20, 15000), start);
      if (options.slide) source.frequency.exponentialRampToValueAtTime(clamp(options.slide, 20, 15000), start + duration);
      if (options.detune) source.detune.value = options.detune;
      const gain = this._node('createGain'), attack = Math.min(duration / 3, options.attack || 0.008);
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(level, start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      const nodes = [source, gain];
      if (options.cutoff) { const filter = this._node('createBiquadFilter'); filter.type = 'lowpass'; filter.frequency.value = options.cutoff; filter.Q.value = 0.6; source.connect(filter); filter.connect(gain); nodes.push(filter); }
      else source.connect(gain);
      const pan = this._output(gain, options.pan || 0, bus === 'music' ? this._music : this._effects); if (pan) nodes.push(pan);
      const end = start + duration + 0.02;
      const record = this._record([source], nodes, gain, bus, end); record.priority = finite(options.priority);
      source.start(start); source.stop(end); return record;
    }
    _noiseHit(start, duration, level, frequency, type = 'highpass', bus = 'music', pan = 0) {
      if (!this._hasRoom(bus) || level <= 0) return;
      const source = this._node('createBufferSource'); source.buffer = this._noise;
      const filter = this._node('createBiquadFilter'); filter.type = type; filter.frequency.value = frequency; filter.Q.value = 0.7;
      const gain = this._node('createGain'); gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(level, start + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter); filter.connect(gain);
      const panner = this._output(gain, pan, bus === 'music' ? this._music : this._effects);
      const end = start + duration + 0.01;
      this._record([source], [source, filter, gain, ...(panner ? [panner] : [])], gain, bus, end); source.start(start); source.stop(end);
    }
    _kick(start, level = 0.15) { this._tone(105, start, 0.23, level, 'sine', 'music', { slide: 39 }); this._noiseHit(start, 0.012, level * 0.09, 900, 'lowpass'); }
    _snare(start, level = 0.075) { this._noiseHit(start, 0.16, level * 0.8, 1650, 'bandpass'); this._tone(155, start, 0.11, level * 0.3, 'sine', 'music', { slide: 115 }); }
    _hat(start, open = false, level = 0.03) { this._noiseHit(start, open ? 0.14 : 0.032, level * 0.75, 5200, 'highpass', 'music', 0.25); }
    _piano(frequency, start, duration, level, pan = 0) {
      // Decaying sine partials give the fallback keys a warm struck tone,
      // without the sustained buzzy waveform of a bare oscillator chord.
      this._tone(frequency, start, duration, level, 'sine', 'music', { pan, attack: 0.006 });
      this._tone(frequency * 2.005, start, duration * 0.38, level * 0.22, 'sine', 'music', { pan, attack: 0.004 });
    }
    _chord(notes, start, duration, level, wave, cutoff) {
      notes.forEach((note, i) => {
        if (wave === 'piano') this._piano(midi(note), start + i * 0.009, duration, level, (i - 1) * 0.15);
        else this._tone(midi(note), start + i * 0.009, duration, level, wave, 'music', { cutoff, pan: (i - 1) * 0.2, attack: 0.035, detune: i % 2 ? -4 : 4 });
      });
    }
    _scheduleMusic(key) {
      const now = this._context.currentTime;
      const sample = this._samples.get('music-' + key), generated = !!sample;
      if (key !== this._musicKey || this._musicGenerated !== generated) {
        const changed = key !== this._musicKey;
        this._cancelMusic(); this._musicKey = key; this._musicGenerated = generated; this._nextNote = now + 0.035; this._nextMusicAt = now + 0.035;
        if (changed && ['biscuit', 'neon', 'meadow'].includes(key) && now - (this._stationLast.get(key) ?? -100) > 90) this._stationAt = now + 1.5;
      }
      if (key === 'off') return;
      if (now >= this._stationAt) {
        this._stationAt = Infinity;
        if (this.settings.effectsVolume > 0 && this._say('voice-radio-' + key, undefined, 8)) this._stationLast.set(key, now);
      }
      if (generated) {
        const duration = sample.buffer.duration, fade = Math.min(0.7, duration / 8);
        if (this._nextMusicAt < now - duration) this._nextMusicAt = now + 0.025;
        let scheduled = 0;
        while (this._nextMusicAt < now + 0.18 && scheduled++ < 2) {
          const record = this._sampleVoice('music-' + key, { bus: 'music', start: this._nextMusicAt, duration, fade, level: 0.24 });
          if (!record) break;
          this._nextMusicAt += duration - fade;
        }
        return;
      }
      const tempo = { biscuit: 112, neon: 104, meadow: 78, foot: 84 }[key] || 84;
      const stepDuration = 60 / tempo / 4;
      // No setInterval and no backlog: a tab returning from suspension starts a
      // fresh beat, with at most eight steps scheduled in any animation frame.
      if (this._nextNote < now - stepDuration) this._nextNote = now + 0.025;
      let scheduled = 0;
      while (this._nextNote < now + 0.18 && scheduled++ < 8) {
        const step = this._step++ % 128;
        const swing = key === 'biscuit' && step % 2 ? stepDuration * 0.13 : key === 'meadow' && step % 2 ? stepDuration * 0.07 : 0;
        const start = this._nextNote + swing;
        this._musicStep(key, step, start, stepDuration); this._nextNote += stepDuration;
      }
    }
    _musicStep(key, step, start, unit) {
      const bar = Math.floor(step / 16), beat = step % 16;
      if (key === 'biscuit') {
        const roots = [41, 41, 46, 46, 43, 43, 48, 48], rootNote = roots[bar];
        if (beat % 4 === 0 || beat === 14 && bar % 2) this._kick(start);
        if (beat === 4 || beat === 12) this._snare(start, 0.085);
        if (beat % 2 === 0) this._hat(start, beat === 10, beat % 4 === 2 ? 0.043 : 0.025);
        const bass = { 0: 0, 3: 12, 6: 7, 8: 0, 10: 10, 13: 7, 15: bar % 2 ? -2 : 12 };
        if (bass[beat] !== undefined) this._tone(midi(rootNote + bass[beat]), start, unit * 1.5, 0.125, 'triangle', 'music', { cutoff: 900 });
        if ([2, 7, 10, 14].includes(beat)) this._chord([rootNote + 24, rootNote + 28, rootNote + 31, rootNote + 34], start, unit * 1.4, 0.024, 'piano');
        if (beat === 5 || beat === 13) this._tone(midi(rootNote + 31), start, unit * 0.65, 0.024, 'triangle', 'music', { cutoff: 1900, pan: -0.3 });
        const melody = [[72, null, 74, 77], [79, 77, 74, 72], [77, null, 79, 82], [84, 82, 79, 77], [74, 77, null, 79], [82, 79, 77, 74], [79, null, 81, 84], [86, 84, 81, 79]];
        if (beat % 4 === 1 && melody[bar][Math.floor(beat / 4)]) this._tone(midi(melody[bar][Math.floor(beat / 4)]), start, unit * 1.7, 0.028, 'triangle', 'music', { pan: -0.2 });
      } else if (key === 'neon') {
        const roots = [45, 45, 41, 41, 48, 48, 43, 43], note = roots[bar];
        if (beat === 0 || beat === 8 || beat === 11 && bar % 2) this._kick(start, 0.2);
        if (beat === 4 || beat === 12) this._snare(start, 0.1);
        if (beat % 2 === 0) this._hat(start, beat === 14, 0.03);
        if (beat % 2 === 0) this._tone(midi(note + (beat % 4 ? 12 : 0)), start, unit * 1.6, 0.105, 'triangle', 'music', { cutoff: 650 });
        if (beat === 0) this._chord([note + 24, note + 27, note + 31], start, unit * 13, 0.021, 'triangle', 1000);
        const arp = [0, 7, 12, 15, 19, 15, 12, 7];
        this._piano(midi(note + 24 + arp[(beat + (bar % 2) * 2) % 8]), start, unit * 0.9, 0.019, beat % 2 ? 0.35 : -0.35);
        if (bar >= 4 && beat % 4 === 2) this._tone(midi(note + 36 + [7, 3, 0, 10][Math.floor(beat / 4)]), start, unit * 2.8, 0.025, 'triangle');
      } else if (key === 'meadow') {
        const note = [38, 38, 43, 43, 41, 41, 36, 45][bar];
        if (beat === 0 || beat === 10) this._kick(start, 0.14);
        if (beat === 8) this._snare(start, 0.065);
        if (beat % 4 === 2) this._hat(start, false, 0.03);
        if ([0, 6, 10, 14].includes(beat)) this._tone(midi(note + (beat === 6 ? 7 : beat === 14 ? 12 : 0)), start, unit * 2.6, 0.13, 'sine');
        if (beat === 4 || beat === 12) {
          const chord = [note + 24, note + 27, note + 31, note + 34];
          this._chord(chord, start, unit * 1.7, 0.026, 'triangle', 1700);
          // Quiet written echo taps give the offbeat organ space without a
          // delay feedback loop retaining old stations after a radio change.
          this._chord(chord.slice(1), start + unit * 2, unit * 2, 0.009, 'sine', 1100);
        }
        if (bar % 2 && [2, 7, 11].includes(beat)) this._tone(midi(note + 36 + [7, 12, 3][[2, 7, 11].indexOf(beat)]), start, unit * 2.5, 0.027, 'sine', 'music', { pan: -0.3 });
      } else {
        // A gentle town theme: sparse bells, warm chords, and a soft bass pulse.
        const note = [48, 48, 53, 53, 45, 45, 55, 55][bar];
        if (beat === 0) { this._chord([note + 12, note + 16, note + 19], start, unit * 12, 0.022, 'sine', 1200); this._tone(midi(note - 12), start, unit * 6, 0.06, 'sine'); }
        const melody = [12, 16, 19, 23, 21, 19, 16, 14];
        if (beat === 2 || beat === 10) {
          const pitch = midi(note + melody[(bar * 2 + (beat === 10 ? 1 : 0)) % 8]);
          this._tone(pitch, start, unit * 4, 0.036, 'sine', 'music', { pan: beat === 2 ? -0.3 : 0.3 });
          this._tone(pitch * 2.01, start, unit * 1.7, 0.008, 'sine');
        }
        if (beat === 6 || beat === 14) this._hat(start, false, 0.008);
      }
    }

    _updateFootsteps(game, frame, elapsed) {
      const player = game?.player || {}, dt = clamp(finite(elapsed, 1 / 60), 0, 0.1);
      const position = frame.mode === 'foot' && Number.isFinite(player.x) && Number.isFinite(player.y) ? { x: player.x, y: player.y } : null;
      const previous = this._lastFootPosition; this._lastFootPosition = position;
      const distance = position && previous ? Math.hypot(position.x - previous.x, position.y - previous.y) : 0;
      // Walking into a wall has no footsteps; camera changes, dismounts and
      // recovery teleports reset cadence instead of becoming artificial steps.
      if (!frame.walking || !position || !previous || distance > Math.max(8, dt * 300)) { this._footstep = 0; return; }
      this._footstep -= dt;
      // Render frames may outnumber simulation ticks. A stationary render or a
      // dt-zero interaction preserves cadence; only displacement emits a step.
      if (dt > 0 && distance > 0.03 && this._footstep <= 0) { this._footstep = frame.running ? 0.24 : 0.36; this._stepSound(frame.surface); }
    }
    _stepSound(surface = 'pavement') {
      const start = this._context.currentTime;
      const variant = 0.95 + (this._variation++ % 5) * 0.025;
      if (this._sampleVoice('foot-' + surface, { rate: variant, level: surface === 'pavement' ? 0.065 : 0.075, duration: 0.22 })) return;
      this._noiseHit(start, surface === 'sand' ? 0.13 : 0.07, surface === 'pavement' ? 0.042 : 0.06, surface === 'grass' ? 1900 : 450, surface === 'grass' ? 'bandpass' : 'lowpass', 'effects');
      this._tone(92 * variant, start, 0.065, surface === 'pavement' ? 0.065 : 0.035, 'sine', 'effects', { slide: 55 });
    }
    playUI(name, game, details = {}) {
      if (!UI_EVENTS.has(name)) return false;
      this._uiPlaying = true; this._uiAllowed = true;
      try { const played = this.play(name, game, details); this._applyVolumes(); return played; }
      finally { this._uiPlaying = false; }
    }
    play(name, game, details = {}) {
      try {
        if ((!this._active && !this._uiPlaying) || this._failed || this._disposed || this._context?.state !== 'running' || this.settings.muted || this.settings.masterVolume <= 0 || this.settings.effectsVolume <= 0) return false;
        const now = this._context.currentTime;
        details = details && typeof details === 'object' ? details : {};
        const location = this._uiPlaying ? { attenuation: 1, pan: 0 } : spatialAt(game, details, this._viewYaw);
        const intensity = clamp(finite(details.intensity, 0.65), 0, 1), scale = location.attenuation * (0.3 + intensity * 0.7);
        if (location.attenuation < 0.005 || intensity <= 0) return false;
        if (name === 'resident') {
          const index = RESIDENT_LINES.findIndex(line => line.replace(/[’']/g, "'") === String(details.text || '').replace(/[’']/g, "'").toUpperCase());
          const spoken = index >= 0 && this._say('voice-resident-' + index, location, 2.8);
          if (spoken) this._lastPlayedEvent = name;
          return spoken;
        }
        const critical = ['heat', 'search', 'busted', 'explosion'].includes(name);
        if (!this._hasRoom('effects') && !(critical && this._reserveEffects(3))) return false;
        const source = details.id || details.sourceId || (Number.isFinite(details.x) ? Math.round(details.x / 20) + ':' + Math.round(details.y / 20) : 'local');
        const eventKey = name + ':' + source, cooldown = name === 'horn' ? 0.18 : name === 'crash' ? 0.13 : name === 'resident' ? 2.8 : 0.045;
        if (now - (this._lastEvent.get(eventKey) ?? -10) < cooldown) return false;
        this._lastEvent.set(eventKey, now);
        if (this._lastEvent.size > 256) this._lastEvent.delete(this._lastEvent.keys().next().value);
        this._lastPlayedEvent = name; this._lastPlayedSample = null;
        const variant = 0.94 + (this._variation++ % 7) * 0.02;
        const materialKey = details.destroyed === true ? { wood: 'break-wood', metal: 'break-metal', stone: 'break-stone', foliage: 'break-foliage' }[details.material] : null;
        const choices = {
          horn: ['horn'], pop: ['pop'], hammer: ['hammer'], cannon: ['cannon-launch'], party: ['cannon-burst'],
          crash: materialKey ? [materialKey, intensity < 0.55 ? 'impact-light' : 'impact-heavy', 'crash'] : [intensity < 0.55 ? 'impact-light' : 'impact-heavy', 'crash'],
          explosion: ['explosion'], biscuit: ['biscuit'], tape: ['tape'], refill: ['refill'], enter: ['door'], exit: ['door'], splash: ['splash']
        }[name];
        if (choices) for (const key of choices) {
          const kind = game?.current?.kind, rate = name === 'horn' ? kind === 'van' ? 0.75 : kind === 'sports' ? 1.15 : 1 : variant;
          const record = this._sampleVoice(key, { rate, level: (name === 'explosion' ? 0.29 : name === 'crash' ? 0.23 : 0.18) * scale, pan: location.pan, priority: critical ? 2 : 0 });
          if (record) { this._lastPlayedSample = key; if (name === 'explosion') this._duck(0.6); return true; }
        }
        const tone = (hz, offset, duration, level, wave = 'sine', options = {}) => this._tone(hz * variant, now + offset, duration, level * scale, wave, 'effects', { pan: location.pan, priority: critical ? 2 : 0, ...options });
        const hit = (duration, level, hz, type = 'highpass', offset = 0) => this._noiseHit(now + offset, duration, level * scale, hz, type, 'effects', location.pan);
        const notes = (pitches, duration = 0.13, wave = 'triangle', level = 0.12) => pitches.forEach((note, i) => tone(midi(note), i * duration * 0.72, duration, level, wave));
        switch (name) {
          case 'radio': hit(0.065, 0.04, 2500, 'bandpass'); notes([83, 88], 0.055, 'sine', 0.065); break;
          case 'menu-open': hit(0.06, 0.055, 1700, 'bandpass'); tone(240, 0, 0.06, 0.04, 'triangle'); break;
          case 'menu-close': hit(0.055, 0.045, 900, 'bandpass'); break;
          case 'menu-select': case 'equip': hit(0.035, 0.065, 2400, 'bandpass'); tone(280, 0.02, 0.05, 0.055, 'triangle', { slide: 190 }); break;
          case 'enter': hit(0.09, 0.12, 700, 'lowpass'); tone(140, 0.035, 0.13, 0.15, 'sine', { slide: 65 }); break;
          case 'exit': hit(0.08, 0.09, 1100, 'bandpass'); tone(180, 0.035, 0.12, 0.11, 'sine', { slide: 75 }); break;
          case 'horn': {
            const kind = game?.current?.kind;
            const base = kind === 'van' ? 185 : kind === 'sports' ? 415 : 330;
            tone(base, 0, 0.38, 0.105, 'sawtooth', { cutoff: 1800 }); tone(base * 1.25, 0, 0.36, 0.075, 'square', { cutoff: 1800 }); break;
          }
          case 'pop': hit(0.035, 0.16, 1100, 'bandpass'); hit(0.19, 0.045, 3400, 'highpass', 0.035); break;
          case 'hammer': tone(100, 0, 0.19, 0.18, 'sine', { slide: 48 }); tone(520, 0.04, 0.15, 0.06, 'sine', { slide: 210 }); hit(0.045, 0.065, 600, 'lowpass'); break;
          case 'cannon': tone(105, 0, 0.2, 0.18, 'sine', { slide: 43 }); hit(0.08, 0.14, 600, 'bandpass'); tone(800, 0.09, 0.25, 0.025, 'sine', { slide: 430 }); break;
          case 'party': hit(0.1, 0.17, 1400, 'bandpass'); hit(0.4, 0.075, 3300, 'highpass', 0.075); tone(80, 0, 0.2, 0.08, 'sine', { slide: 35 }); break;
          case 'empty': hit(0.025, 0.065, 1800, 'bandpass'); tone(170, 0.015, 0.07, 0.045, 'triangle'); break;
          case 'flop': case 'land': hit(0.09, 0.085, 650, 'lowpass'); tone(100, 0, 0.12, 0.11, 'sine', { slide: 45 }); break;
          case 'jump': hit(0.06, 0.06, 1000, 'bandpass'); break;
          case 'splash': hit(0.48, 0.14, 850, 'lowpass'); hit(0.18, 0.07, 2100, 'bandpass', 0.075); break;
          case 'crash':
            hit(intensity < 0.55 ? 0.12 : 0.3, 0.15, details.material === 'wood' ? 1300 : 700, 'bandpass');
            tone(100, 0, 0.21, 0.17, 'sine', { slide: 38 });
            if (details.material === 'metal' || details.material === 'vehicle') { tone(680, 0.04, 0.28, 0.025, 'sine'); hit(0.05, 0.045, 2100, 'bandpass', 0.09); }
            break;
          case 'explosion': hit(0.65, 0.22, 650, 'lowpass'); tone(75, 0, 0.6, 0.22, 'sine', { slide: 25 }); hit(0.32, 0.09, 1900, 'bandpass', 0.12); this._duck(0.6); break;
          case 'fire-start': hit(0.32, 0.065, 1200, 'bandpass'); break;
          case 'heat': notes([67, 61], 0.14, 'sine', 0.055); this._pendingSearch = null; this._say('voice-police-pursuit', location, 10); this._duck(0.5); break;
          case 'search':
            hit(0.05, 0.045, 1500, 'bandpass');
            if (!this._say('voice-police-search', location, 10) && this._samples.has('voice-police-search')) this._pendingSearch = { location, at: now };
            break;
          case 'busted': notes([67, 64, 60, 55], 0.24, 'triangle', 0.13); break;
          case 'accept': notes([60, 64, 67], 0.13); break;
          case 'checkpoint': notes([76, 79], 0.13, 'sine', 0.15); break;
          case 'complete': notes([60, 64, 67, 72, 76], 0.19, 'triangle'); break;
          case 'purchase': notes([79, 84, 88], 0.1, 'sine', 0.12); break;
          case 'consume': tone(300, 0, 0.11, 0.11, 'sine', { slide: 700 }); tone(620, 0.1, 0.13, 0.1, 'sine', { slide: 900 }); break;
          case 'biscuit': hit(0.15, 0.045, 2100, 'highpass'); hit(0.065, 0.11, 1050, 'bandpass', 0.18); hit(0.055, 0.06, 1400, 'bandpass', 0.3); break;
          case 'tape': hit(0.32, 0.11, 2200, 'bandpass'); hit(0.09, 0.07, 550, 'lowpass', 0.35); break;
          case 'refill': hit(0.04, 0.09, 1450, 'bandpass'); tone(350, 0.08, 0.08, 0.05, 'triangle', { slide: 200 }); hit(0.04, 0.06, 650, 'lowpass', 0.2); break;
          case 'repair': [0, 0.17, 0.34].forEach(offset => { hit(0.035, 0.08, 1500, 'bandpass', offset); tone(590, offset, 0.1, 0.035, 'sine'); }); break;
          case 'paint': hit(0.65, 0.075, 1800, 'bandpass'); break;
          case 'wash': hit(0.9, 0.085, 900, 'lowpass'); hit(0.4, 0.04, 1800, 'bandpass', 0.45); break;
          case 'style': notes([74, 81, 86], 0.11, 'triangle', 0.09); break;
          case 'escape': notes([67, 72, 76, 79], 0.17, 'sine', 0.13); break;
          default: return false;
        }
        return true;
      } catch (error) { this._fail(error); return false; }
    }

    dispose() {
      if (this._disposed) return;
      this._silence(); this._disposed = true; this._state = 'disposed';
      this._samples.clear(); this._loadingSamples.clear();
      if (this._context) {
        for (const node of [this._master, this._music, this._effects, this._limiter]) { try { node?.disconnect(); } catch (_) {} }
        try { const close = this._context.close(); if (close?.catch) close.catch(() => {}); } catch (_) {}
      }
    }
  }

  const api = { STATIONS, DEFAULT_SETTINGS, normalizeSettings, deriveAudioFrame, AudioDirector };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MayhemAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
