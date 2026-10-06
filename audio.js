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
  const SAMPLE_KEYS = ['engine-compact', 'engine-sports', 'engine-van', 'siren', 'horn', 'crash', 'pop'];
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

  // A pure model is also usable by diagnostics/tests without creating Web Audio.
  // Map x/y and speed use 20 units per metre, as in the vehicle physics engine.
  function deriveAudioFrame(game, options = {}) {
    const player = game?.player || {}, cars = Array.isArray(game?.cars) ? game.cars : [];
    const police = Array.isArray(game?.police) ? game.police : [];
    const vehicle = player.vehicleId ? cars.find(car => car.id === player.vehicleId) : null;
    const listener = vehicle || player, input = options.input || {};
    const yaw = finite(options.viewYaw, finite(listener.angle));
    const hasEngine = car => car && finite(car.health, 100) > 0 && finite(car.engineHealth, 100) > 0 && !car.exploded;
    const spatial = entity => {
      const dx = finite(entity.x) - finite(listener.x), dy = finite(entity.y) - finite(listener.y);
      const distance = Math.hypot(dx, dy);
      return { distance, pan: distance > 1 ? clamp((-dx * Math.sin(yaw) + dy * Math.cos(yaw)) / distance, -1, 1) : 0,
        attenuation: distance < 900 ? (1 - distance / 900) / (1 + (distance / 180) ** 2) : 0 };
    };
    const engine = (car, controlled, location) => {
      const kind = ENGINE_TYPES[car.kind] ? car.kind : 'compact', type = ENGINE_TYPES[kind];
      const model = VehicleStats?.getModel ? VehicleStats.getModel(car) : root.MayhemCore?.CAR_TYPES?.[kind];
      const limit = clamp(finite(model?.maxSpeed, type.limit), 1, 1000);
      const speed = clamp(Math.abs(finite(car.speed)), 0, limit * 1.7), ratio = speed / limit;
      const throttle = controlled ? (input.up || input.down && finite(car.speed) < 15 ? 1 : 0.18) : clamp(ratio * 1.3 + 0.18, 0.18, 0.85);
      const gear = Math.min(3, Math.floor(ratio * 4));
      const rev = clamp((ratio * 4 - gear) * 0.6 + throttle * 0.3 + (controlled && input.boost ? 0.16 : 0), 0, 1.2);
      return { id: String(car.id), kind, controlled, speed, throttle, frequency: type.idle + type.range * rev,
        cutoff: type.cutoff + 1500 * rev, gain: (controlled ? 0.13 : 0.075 * location.attenuation) * (0.65 + throttle * 0.35),
        pan: controlled ? 0 : location.pan, distance: controlled ? 0 : location.distance };
    };
    const nearby = cars.filter(car => hasEngine(car) && car.id !== vehicle?.id && car.traffic)
      .concat(police.filter(hasEngine)).map(car => ({ car, location: spatial(car) }))
      .filter(item => item.location.attenuation > 0.004).sort((a, b) => a.location.distance - b.location.distance).slice(0, 4);
    const engines = nearby.map(item => engine(item.car, false, item.location));
    if (hasEngine(vehicle)) engines.unshift(engine(vehicle, true, {}));
    const heat = clamp(finite(game?.heat), 0, 3);
    const sirens = heat > 0 ? police.filter(Boolean).map(cop => ({ id: String(cop.id), ...spatial(cop) }))
      .filter(cop => cop.attenuation > 0.004).sort((a, b) => a.distance - b.distance).slice(0, 3)
      .map(cop => ({ ...cop, gain: cop.attenuation * 0.095, rate: heat > 1 ? 1.45 : 0.65 })) : [];
    let skid = 0, road = 0, boost = 0;
    if (vehicle) {
      const angle = finite(vehicle.angle), lateral = Math.abs(-finite(vehicle.vx) * Math.sin(angle) + finite(vehicle.vy) * Math.cos(angle));
      const speed = Math.abs(finite(vehicle.speed));
      const grounded = vehicle.grounded !== false && vehicle.upright !== false && finite(vehicle.elevation) < 0.2;
      skid = grounded && speed > 35 ? clamp((input.brake ? speed / 250 : lateral / 140) * 0.11, 0, 0.11) : 0;
      road = clamp(speed / 370, 0, 1.3) * 0.055;
      boost = input.boost && input.up ? 0.06 : 0;
    }
    const walking = !vehicle && player.grounded !== false && finite(player.stunned) <= 0 &&
      !(game?.ragdolls?.get && game.ragdolls.get(player.id)) && !!(input.up || input.down || input.left || input.right);
    return { mode: vehicle ? 'vehicle' : 'foot', engines, sirens, skid, road, boost, walking, running: !!input.boost };
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
          this._limiter.threshold.value = -12; this._limiter.knee.value = 12;
          this._limiter.ratio.value = 5; this._limiter.attack.value = 0.004; this._limiter.release.value = 0.18;
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
        if (!active) { this._silence(); return; }
        this._active = true;
        const frame = deriveAudioFrame(game, options); this._mode = frame.mode;
        this._applyVolumes();
        if (this.settings.effectsVolume > 0) {
          this._syncEngines(frame.engines); this._syncSirens(frame.sirens);
          this._syncNoise('skid', frame.skid, 1600, 'bandpass', 1.5);
          this._syncNoise('road', frame.road + frame.boost, frame.boost ? 2100 : 550, 'lowpass', 0.7);
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
          if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 60 || !buffer.numberOfChannels) throw new Error('Invalid decoded audio');
          const asset = this._sampleData[key], loop = asset.loop === true;
          let peak = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < data.length; i++) { if (!Number.isFinite(data[i])) data[i] = 0; peak = Math.max(peak, Math.abs(data[i])); }
          }
          if (peak < 0.00001) throw new Error('Silent decoded audio');
          const scale = peak > 0.9 ? 0.9 / peak : 1;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel), fade = Math.min(Math.floor(buffer.sampleRate * 0.005), Math.floor(data.length / 4));
            for (let i = 0; i < data.length; i++) data[i] *= scale;
            if (loop) for (let i = 0; i < fade; i++) { data[i] *= i / fade; data[data.length - 1 - i] *= i / fade; }
          }
          this._samples.set(key, { buffer, loop, gain: clamp(finite(asset.gain, 1), 0, 1), baseFrequency: clamp(finite(asset.baseFrequency, 80), 20, 1000) });
        }).catch(() => { if (!this._disposed) this._failedSamples.add(key); })
          .finally(() => this._loadingSamples.delete(key));
      }
    }

    _sampleVoice(key, options = {}) {
      const sample = this._samples.get(key);
      if (!sample || this._voices.size >= 80) return null;
      const now = this._context.currentTime, loop = options.loop === true;
      if (loop && !sample.loop) return null;
      const source = this._node('createBufferSource'); source.buffer = sample.buffer; source.loop = loop;
      const rate = clamp(finite(options.rate, 1), 0.5, 2.5); source.playbackRate.value = rate;
      const gain = this._node('createGain'); gain.gain.value = 0;
      source.connect(gain);
      const pan = this._output(gain, options.pan, this._effects);
      const duration = Math.min(sample.buffer.duration / rate, clamp(finite(options.duration, sample.buffer.duration), 0.02, 3));
      const end = loop ? Infinity : now + duration + 0.01;
      const record = this._record([source], [source, gain, ...(pan ? [pan] : [])], gain, 'effects', end);
      record.generated = true; record.sampleKey = key; record.sample = sample; record.main = source; record.pan = pan;
      if (!loop) {
        const level = clamp(finite(options.level, 0.15), 0, 0.3) * sample.gain;
        gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(level, now + Math.min(0.008, duration / 4));
        gain.gain.setValueAtTime(level, now + Math.max(duration / 2, duration - 0.045));
        gain.gain.linearRampToValueAtTime(0, now + duration);
      }
      source.start(now); if (!loop) source.stop(end);
      return record;
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
      this._ramp(this._master.gain, this._active && !this.settings.muted ? this.settings.masterVolume : 0);
      this._ramp(this._music.gain, this.settings.musicVolume);
      this._ramp(this._effects.gain, this.settings.effectsVolume);
    }
    _record(sources, nodes, gain, bus, end = Infinity) {
      const record = { sources, nodes, gain, bus, end, stopped: false };
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
    }
    _stopEffects() {
      for (const record of this._voices) if (record.bus === 'effects') this._stop(record);
      this._engines.clear(); this._sirens.clear(); this._noiseLoops.clear();
      this._lastFootPosition = null;
    }
    _silence() {
      this._active = false; this._mode = 'idle'; this._footstep = 0;
      if (!this._context) return;
      try { this._ramp(this._master?.gain, 0, 0.015); } catch (_) {}
      this._cancelMusic(); this._stopEffects();
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
      record.main = main; record.sub = sub; record.filter = filter; record.pan = pan; record.kind = description.kind;
      main.start(); sub.start(); intake.start(); return record;
    }
    _syncEngines(descriptions) {
      const wanted = new Set(descriptions.map(item => item.id));
      for (const [id, record] of this._engines) if (!wanted.has(id)) { this._stop(record); this._engines.delete(id); }
      for (const item of descriptions) {
        let record = this._engines.get(item.id);
        const key = 'engine-' + item.kind, sample = this._samples.get(key), generated = !!sample?.loop;
        if (record && (record.kind !== item.kind || !!record.generated !== generated)) { this._stop(record); record = null; }
        if (!record) {
          record = generated ? this._sampleVoice(key, { loop: true, pan: item.pan, rate: item.frequency / sample.baseFrequency }) : this._engine(item);
          if (!record) { this._engines.delete(item.id); continue; }
          record.kind = item.kind; this._engines.set(item.id, record);
        }
        this._ramp(record.gain.gain, item.gain * (record.sample?.gain ?? 1), 0.06);
        if (record.generated) this._ramp(record.main.playbackRate, clamp(item.frequency / record.sample.baseFrequency, 0.5, 2.5), 0.08);
        else {
          this._ramp(record.main.frequency, item.frequency, 0.08);
          this._ramp(record.sub.frequency, item.frequency * 0.5, 0.08); this._ramp(record.filter.frequency, item.cutoff, 0.08);
        }
        if (record.pan) this._ramp(record.pan.pan, item.pan, 0.06);
      }
    }
    _siren(item) {
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
    _syncNoise(id, level, frequency, type, q) {
      let record = this._noiseLoops.get(id);
      if (level < 0.001) { if (record) { this._stop(record); this._noiseLoops.delete(id); } return; }
      if (!record) {
        const source = this._node('createBufferSource'); source.buffer = this._noise; source.loop = true;
        const filter = this._node('createBiquadFilter'); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
        const gain = this._node('createGain'); gain.gain.value = 0; source.connect(filter); filter.connect(gain); gain.connect(this._effects);
        record = this._record([source], [source, filter, gain], gain, 'effects'); record.filter = filter;
        this._noiseLoops.set(id, record); source.start();
      }
      this._ramp(record.gain.gain, level, 0.05); this._ramp(record.filter.frequency, frequency, 0.08);
    }

    _tone(frequency, start, duration, level, wave = 'sine', bus = 'music', options = {}) {
      if (this._voices.size >= 80 || !frequency || level <= 0) return;
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
      this._record([source], nodes, gain, bus, end); source.start(start); source.stop(end);
    }
    _noiseHit(start, duration, level, frequency, type = 'highpass', bus = 'music', pan = 0) {
      if (this._voices.size >= 80 || level <= 0) return;
      const source = this._node('createBufferSource'); source.buffer = this._noise;
      const filter = this._node('createBiquadFilter'); filter.type = type; filter.frequency.value = frequency; filter.Q.value = 0.7;
      const gain = this._node('createGain'); gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(level, start + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter); filter.connect(gain);
      const panner = this._output(gain, pan, bus === 'music' ? this._music : this._effects);
      const end = start + duration + 0.01;
      this._record([source], [source, filter, gain, ...(panner ? [panner] : [])], gain, bus, end); source.start(start); source.stop(end);
    }
    _kick(start, level = 0.18) { this._tone(115, start, 0.2, level, 'sine', 'music', { slide: 36 }); }
    _snare(start, level = 0.09) { this._noiseHit(start, 0.14, level, 1200, 'highpass'); this._tone(165, start, 0.09, level * 0.35, 'triangle'); }
    _hat(start, open = false, level = 0.038) { this._noiseHit(start, open ? 0.17 : 0.035, level, 6500, 'highpass', 'music', 0.25); }
    _chord(notes, start, duration, level, wave, cutoff) {
      notes.forEach((note, i) => this._tone(midi(note), start + i * 0.009, duration, level, wave, 'music', { cutoff, pan: (i - 1) * 0.2, attack: 0.035, detune: i % 2 ? -4 : 4 }));
    }
    _scheduleMusic(key) {
      const now = this._context.currentTime;
      if (key !== this._musicKey) { this._cancelMusic(); this._musicKey = key; this._nextNote = now + 0.035; }
      if (key === 'off') return;
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
        if ([2, 7, 10, 14].includes(beat)) this._chord([rootNote + 24, rootNote + 28, rootNote + 31, rootNote + 34], start, unit * 1.1, 0.022, 'sawtooth', 1450);
        const melody = [[72, null, 74, 77], [79, 77, 74, 72], [77, null, 79, 82], [84, 82, 79, 77], [74, 77, null, 79], [82, 79, 77, 74], [79, null, 81, 84], [86, 84, 81, 79]];
        if (beat % 4 === 1 && melody[bar][Math.floor(beat / 4)]) this._tone(midi(melody[bar][Math.floor(beat / 4)]), start, unit * 1.7, 0.028, 'triangle', 'music', { pan: -0.2 });
      } else if (key === 'neon') {
        const roots = [45, 45, 41, 41, 48, 48, 43, 43], note = roots[bar];
        if (beat === 0 || beat === 8 || beat === 11 && bar % 2) this._kick(start, 0.2);
        if (beat === 4 || beat === 12) this._snare(start, 0.1);
        if (beat % 2 === 0) this._hat(start, beat === 14, 0.03);
        if (beat % 2 === 0) this._tone(midi(note + (beat % 4 ? 12 : 0)), start, unit * 1.6, 0.105, 'sawtooth', 'music', { cutoff: 650 });
        if (beat === 0) this._chord([note + 24, note + 27, note + 31], start, unit * 13, 0.024, 'sawtooth', 1000);
        const arp = [0, 7, 12, 15, 19, 15, 12, 7];
        this._tone(midi(note + 24 + arp[(beat + (bar % 2) * 2) % 8]), start, unit * 0.8, 0.022, 'square', 'music', { cutoff: 2400, pan: beat % 2 ? 0.35 : -0.35 });
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
      if (dt > 0 && distance > 0.03 && this._footstep <= 0) { this._footstep = frame.running ? 0.24 : 0.36; this._stepSound(); }
    }
    _stepSound() {
      const start = this._context.currentTime;
      this._noiseHit(start, 0.07, 0.06, 450, 'lowpass', 'effects');
      this._tone(92, start, 0.065, 0.07, 'sine', 'effects', { slide: 55 });
    }
    play(name, game) {
      try {
        if (!this._active || this._context?.state !== 'running' || this.settings.muted || this.settings.effectsVolume <= 0) return false;
        const now = this._context.currentTime;
        if (now - (this._lastEvent.get(name) ?? -10) < (name === 'horn' ? 0.12 : 0.04)) return false;
        this._lastEvent.set(name, now);
        if (name === 'horn' || name === 'crash' || name === 'pop') {
          const kind = game?.current?.kind;
          const rate = name === 'horn' ? kind === 'van' ? 0.75 : kind === 'sports' ? 1.18 : 1 : 1;
          const duration = { horn: 0.65, crash: 1.5, pop: 0.7 }[name];
          if (this._sampleVoice(name, { rate, duration, level: name === 'crash' ? 0.22 : 0.18 })) return true;
        }
        const tone = (hz, offset, duration, level, wave = 'sine', options = {}) => this._tone(hz, now + offset, duration, level, wave, 'effects', options);
        const hit = (duration, level, hz, type = 'highpass') => this._noiseHit(now, duration, level, hz, type, 'effects');
        const notes = (pitches, duration = 0.13, wave = 'triangle', level = 0.12) => pitches.forEach((note, i) => tone(midi(note), i * duration * 0.72, duration, level, wave));
        switch (name) {
          case 'radio': hit(0.065, 0.04, 2500, 'bandpass'); notes([83, 88], 0.055, 'sine', 0.065); break;
          case 'enter': hit(0.09, 0.12, 700, 'lowpass'); tone(140, 0.035, 0.13, 0.15, 'sine', { slide: 65 }); break;
          case 'exit': hit(0.08, 0.09, 1100, 'bandpass'); tone(180, 0.035, 0.12, 0.11, 'sine', { slide: 75 }); break;
          case 'horn': {
            const kind = game?.current?.kind;
            const base = kind === 'van' ? 185 : kind === 'sports' ? 415 : 330;
            tone(base, 0, 0.38, 0.105, 'sawtooth', { cutoff: 1800 }); tone(base * 1.25, 0, 0.36, 0.075, 'square', { cutoff: 1800 }); break;
          }
          case 'pop': hit(0.15, 0.18, 1600); tone(470, 0, 0.14, 0.12, 'sine', { slide: 140 }); break;
          case 'hammer': tone(120, 0, 0.3, 0.19, 'sine', { slide: 43 }); tone(430, 0.035, 0.2, 0.09, 'triangle', { slide: 120 }); hit(0.07, 0.07, 600, 'lowpass'); break;
          case 'party': hit(0.3, 0.16, 1500); notes([72, 76, 79, 84], 0.13, 'square', 0.06); break;
          case 'flop': tone(250, 0, 0.35, 0.15, 'triangle', { slide: 48 }); hit(0.08, 0.09, 500, 'lowpass'); break;
          case 'jump': tone(180, 0, 0.22, 0.1, 'sine', { slide: 590 }); break;
          case 'crash': hit(0.32, 0.2, 700, 'bandpass'); tone(80, 0, 0.35, 0.2, 'triangle', { slide: 25 }); break;
          case 'heat': notes([67, 61, 67], 0.18, 'square', 0.045); break;
          case 'busted': notes([67, 64, 60, 55], 0.24, 'triangle', 0.13); break;
          case 'accept': notes([60, 64, 67], 0.13); break;
          case 'checkpoint': notes([76, 79], 0.13, 'sine', 0.15); break;
          case 'complete': notes([60, 64, 67, 72, 76], 0.19, 'triangle'); break;
          case 'purchase': notes([79, 84, 88], 0.1, 'sine', 0.12); break;
          case 'consume': tone(300, 0, 0.11, 0.11, 'sine', { slide: 700 }); tone(620, 0.1, 0.13, 0.1, 'sine', { slide: 900 }); break;
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
