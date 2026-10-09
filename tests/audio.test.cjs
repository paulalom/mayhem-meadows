'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AudioDirector, STATIONS, DEFAULT_SETTINGS, normalizeSettings, deriveAudioFrame } = require('../audio.js');

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  event(type, value, time) {
    assert.ok(Number.isFinite(value), `${type} must have a finite value`);
    assert.ok(Number.isFinite(time) && time >= 0, `${type} must have a nonnegative finite time`);
    this.events.push({ type, value, time }); this.value = value;
  }
  setValueAtTime(value, time) { this.event('set', value, time); }
  linearRampToValueAtTime(value, time) { this.event('linear', value, time); }
  exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); this.event('exponential', value, time); }
  cancelScheduledValues(time) { this.events = this.events.filter(event => event.time < time); }
  cancelAndHoldAtTime(time) { this.cancelScheduledValues(time); }
}
class Node {
  constructor(context) { this.context = context; this.connected = false; this.disconnected = false; this.connections = []; context.nodes.push(this); }
  connect(destination) { this.connected = true; this.connections.push(destination); }
  disconnect() { this.disconnected = true; }
}
class Source extends Node {
  constructor(context) { super(context); this.frequency = new Param(440); this.detune = new Param(); this.playbackRate = new Param(1); context.sources.push(this); this.ended = false; }
  start(time = this.context.currentTime) { assert.ok(time >= 0 && Number.isFinite(time)); this.startTime = time; }
  stop(time = this.context.currentTime) { assert.ok(time >= 0 && Number.isFinite(time)); this.stopTime = time; }
}
class Context {
  constructor(state = 'running') { this.state = state; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; this.nodes = []; this.sources = []; }
  createGain() { const node = new Node(this); node.gain = new Param(1); return node; }
  createOscillator() { return new Source(this); }
  createBufferSource() { return new Source(this); }
  createBiquadFilter() { const node = new Node(this); node.frequency = new Param(350); node.Q = new Param(1); return node; }
  createStereoPanner() { const node = new Node(this); node.pan = new Param(); return node; }
  createDynamicsCompressor() {
    const node = new Node(this); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param(); return node;
  }
  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  async decodeAudioData(bytes) { assert.ok(bytes instanceof ArrayBuffer); this.decodeCalls = (this.decodeCalls || 0) + 1; return decodedBuffer(); }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; this.advance(1); }
  advance(seconds) {
    this.currentTime += seconds;
    for (const source of this.sources) if (!source.ended && source.stopTime <= this.currentTime) { source.ended = true; source.onended?.(); }
  }
}
const game = () => ({ player: { id: 'player', x: 0, y: 0, angle: 0, grounded: true, vehicleId: null }, cars: [], police: [], heat: 0 });
const car = (id, kind = 'compact', x = 0, y = 0) => ({ id, kind, x, y, angle: 0, speed: 0, health: 100, grounded: true, upright: true, traffic: true });
async function director(settings) {
  const context = new Context('suspended'), audio = new AudioDirector({ contextFactory: () => context, settings });
  assert.equal(await audio.unlock(), true); return { audio, context };
}
const tick = (audio, context, world, options = {}) => { context.advance(1 / 60); audio.update(world, { active: true, dt: 1 / 60, ...options }); };
const decodedBuffer = () => {
  const channels = [Float32Array.from({ length: 4800 }, (_, i) => Math.cos(i / 13) * 1.4), Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 7) * 1.1)];
  return { duration: 0.6, numberOfChannels: 2, sampleRate: 8000, getChannelData: channel => channels[channel] };
};
const samples = (...keys) => Object.fromEntries(keys.map(key => [key, { data: 'AQID', loop: key.startsWith('engine-') || key === 'siren', gain: 1, baseFrequency: 80 }]));
const settleSamples = () => new Promise(resolve => setImmediate(resolve));

test('saved audio settings validate volumes, station and mute without mutating defaults', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ masterVolume: Infinity, musicVolume: -1, effectsVolume: 3, radioStation: '__proto__', muted: 'yes' }),
    { ...DEFAULT_SETTINGS, musicVolume: 0, effectsVolume: 1 });
  assert.equal(normalizeSettings({ radioStation: 'off', muted: true }).radioStation, 'off');
  assert.deepEqual(STATIONS.map(station => station.id), ['biscuit', 'neon', 'meadow']);
});

test('overall volume defaults legacy saves to 5 percent and clamps saved levels to 1–10 percent', () => {
  assert.equal(DEFAULT_SETTINGS.outputVolume, 0.05);
  assert.equal(normalizeSettings({ masterVolume: 0.75 }).outputVolume, 0.05, 'older saves receive the quieter default');
  for (const invalid of [NaN, Infinity, -Infinity, '0.07', null])
    assert.equal(normalizeSettings({ outputVolume: invalid }).outputVolume, 0.05);
  for (const [saved, expected] of [[-1, 0.01], [0, 0.01], [0.01, 0.01], [0.07, 0.07], [0.1, 0.1], [1, 0.1]])
    assert.equal(normalizeSettings({ outputVolume: saved }).outputVolume, expected);
  const saved = { outputVolume: 0.07, masterVolume: 0.75, musicVolume: 0.45, effectsVolume: 0.65 };
  assert.deepEqual(normalizeSettings(saved), { ...DEFAULT_SETTINGS, ...saved });
  assert.equal(saved.outputVolume, 0.07); assert.equal(DEFAULT_SETTINGS.outputVolume, 0.05);
});

test('overall volume changes the final output live without replacing sources or the saved mix', async () => {
  const { audio, context } = await director({ masterVolume: 0.75, musicVolume: 0.45, effectsVolume: 0.65 });
  const world = game(); world.cars = [car('ride')]; world.player.vehicleId = 'ride'; tick(audio, context, world);
  const output = audio._outputGain, engine = audio._engines.get('ride'), voices = audio.getStatus().voiceCount;
  assert.equal(output.gain.value, 0.05);
  assert.deepEqual(audio._limiter.connections, [output], 'all mixed audio passes through the final gain after compression');
  assert.deepEqual(output.connections, [context.destination]);
  for (const level of [0.01, 0.1, 0.07]) {
    const settings = audio.setSettings({ outputVolume: level });
    assert.equal(settings.outputVolume, level); assert.equal(output.gain.value, level);
    assert.equal(output.gain.events.at(-1).type, 'linear', 'live volume changes ramp without an abrupt click');
    assert.equal(audio._engines.get('ride'), engine); assert.equal(audio.getStatus().voiceCount, voices);
    assert.equal(audio._master.gain.value, 0.75); assert.equal(audio._music.gain.value, 0.45); assert.equal(audio._effects.gain.value, 0.65);
  }
  assert.equal(await audio.unlock(), true); assert.equal(audio._outputGain, output); assert.equal(output.gain.value, 0.07);
  audio.setSettings({ muted: true }); assert.equal(audio._master.gain.value, 0); assert.equal(output.gain.value, 0.07);
  audio.setSettings({ muted: false }); tick(audio, context, world); assert.equal(output.gain.value, 0.07);
  audio.dispose(); assert.equal(output.disconnected, true);
});

test('audio model bounds nearby engines and sirens and projects pan against camera yaw', () => {
  const world = game();
  world.cars = Array.from({ length: 12 }, (_, i) => car(`car-${i}`, 'compact', 0, 30 + i * 20));
  world.police = Array.from({ length: 5 }, (_, i) => car(`cop-${i}`, 'compact', 50 + i * 20, 0));
  let frame = deriveAudioFrame(world, { viewYaw: 0 });
  assert.equal(frame.engines.length, 4); assert.equal(frame.sirens.length, 0);
  assert.equal(frame.engines[0].pan, 1);
  frame = deriveAudioFrame(world, { viewYaw: Math.PI }); assert.equal(frame.engines[0].pan, -1);
  world.heat = 3; frame = deriveAudioFrame(world); assert.equal(frame.sirens.length, 3);
  assert.ok(frame.sirens[0].gain > frame.sirens[1].gain);
  world.player.vehicleId = world.cars[0].id; frame = deriveAudioFrame(world);
  assert.equal(frame.mode, 'vehicle'); assert.equal(frame.engines.length, 5); assert.equal(frame.engines[0].controlled, true);
  world.police.forEach(cop => { cop.x = 10000; }); assert.equal(deriveAudioFrame(world).sirens.length, 0);
});

test('vehicle types and throttle change engine pitch while skid requires motion and ground contact', () => {
  const world = game(), ride = car('ride'); world.cars = [ride]; world.player.vehicleId = ride.id;
  const idle = deriveAudioFrame(world).engines[0];
  let frame = deriveAudioFrame(world, { input: { up: true, boost: true, brake: true } });
  assert.ok(frame.engines[0].frequency > idle.frequency); assert.equal(frame.skid, 0);
  ride.speed = 170; frame = deriveAudioFrame(world, { input: { brake: true } }); assert.ok(frame.skid > 0);
  ride.grounded = false; assert.equal(deriveAudioFrame(world, { input: { brake: true } }).skid, 0);
  const frequencies = ['compact', 'sports', 'van'].map(kind => { ride.kind = kind; return deriveAudioFrame(world).engines[0].frequency; });
  assert.equal(new Set(frequencies).size, 3);
  ride.speed = NaN; ride.x = Infinity; ride.vx = NaN;
  frame = deriveAudioFrame(world, { viewYaw: NaN });
  for (const engine of frame.engines) for (const field of ['frequency', 'gain', 'pan', 'cutoff', 'speed']) assert.ok(Number.isFinite(engine[field]));
});

test('audio model uses live model speed limits and silences failed or exploded engines', () => {
  const world = game(), ride = car('ride', 'sports'); world.cars = [ride]; world.player.vehicleId = ride.id; ride.speed = 230;
  ride.modelId = 'glitterline-sprinkle-gt'; const gt = deriveAudioFrame(world).engines[0].frequency;
  ride.modelId = 'fable-comet-rs'; const rs = deriveAudioFrame(world).engines[0].frequency;
  assert.notEqual(gt, rs);
  ride.engineHealth = 0; assert.equal(deriveAudioFrame(world).engines.length, 0);
  ride.engineHealth = 100; ride.exploded = true; assert.equal(deriveAudioFrame(world).engines.length, 0);
  ride.exploded = false; assert.equal(deriveAudioFrame(world).engines.length, 1);
});

test('unlock is gesture driven, unsupported contexts and denied resume cannot throw', async () => {
  let created = 0;
  const audio = new AudioDirector({ contextFactory: () => { created++; return null; } });
  audio.update(game(), { active: true }); assert.equal(created, 0); assert.equal(audio.getStatus().state, 'locked');
  assert.equal(await audio.unlock(), false); assert.equal(audio.getStatus().state, 'unavailable');
  assert.doesNotThrow(() => { audio.setSettings({ muted: true }); audio.play('crash'); audio.update(game()); audio.dispose(); });
  const denied = new Context('suspended'); denied.resume = async () => { throw new Error('Permission denied'); };
  const other = new AudioDirector({ contextFactory: () => denied }); assert.equal(await other.unlock(), false);
  denied.resume = Context.prototype.resume; assert.equal(await other.unlock(), true);
});

test('audio graph failures latch, disconnect partial nodes and recover only on explicit unlock', async () => {
  const { audio, context } = await director({ musicVolume: 0 });
  const world = game(); world.cars = [car('ride')]; world.player.vehicleId = 'ride';
  let attempts = 0;
  const oscillatorFactory = context.createOscillator;
  context.createOscillator = () => { attempts++; throw new Error('Simulated audio graph failure'); };
  const initialNodes = context.nodes.length;
  tick(audio, context, world);
  assert.equal(audio.getStatus().state, 'unavailable'); assert.equal(audio.getStatus().voiceCount, 0);
  assert.ok(context.nodes.slice(initialNodes).every(node => node.disconnected));
  for (let i = 0; i < 20; i++) tick(audio, context, world);
  assert.equal(attempts, 1); assert.equal(audio.getStatus().state, 'unavailable');
  context.createOscillator = oscillatorFactory;
  assert.equal(await audio.unlock(), true); tick(audio, context, world);
  assert.equal(audio.getStatus().state, 'running'); assert.equal(audio.getStatus().engineCount, 1);
  audio.dispose();

  const partialContext = new Context(), originalCompressor = partialContext.createDynamicsCompressor;
  partialContext.createDynamicsCompressor = () => { throw new Error('Unavailable compressor'); };
  const partialAudio = new AudioDirector({ contextFactory: () => partialContext });
  assert.equal(await partialAudio.unlock(), false);
  assert.ok(partialContext.nodes.every(node => node.disconnected));
  partialContext.createDynamicsCompressor = originalCompressor;
  assert.equal(await partialAudio.unlock(), true); tick(partialAudio, partialContext, game());
  assert.ok(partialAudio.getStatus().voiceCount > 0); partialAudio.dispose();
});

test('footsteps follow actual ground movement and reset for walls, pauses, dismounts and teleports', async () => {
  const { audio, context } = await director({ musicVolume: 0 });
  const world = game(), options = { input: { up: true } };
  for (let i = 0; i < 20; i++) tick(audio, context, world, options);
  assert.equal(audio.getStatus().voiceCount, 0, 'holding forward against a wall is silent');
  world.player.x += 3; tick(audio, context, world, options); assert.equal(audio.getStatus().voiceCount, 2);
  context.advance(0.2); world.player.x += 500; tick(audio, context, world, options);
  assert.equal(audio.getStatus().voiceCount, 0, 'recovery teleport does not make a footstep');
  audio.update(world, { active: false }); world.player.x += 3; tick(audio, context, world, options);
  assert.equal(audio.getStatus().voiceCount, 0, 'resume establishes a fresh position');
  world.cars = [car('ride')]; world.player.vehicleId = 'ride'; tick(audio, context, world, options);
  world.player.vehicleId = null; world.cars = []; world.player.x += 3; tick(audio, context, world, options); context.advance(0.05);
  assert.equal(audio.getStatus().voiceCount, 0, 'dismount establishes a fresh position');
  world.player.grounded = false; world.player.x += 3; tick(audio, context, world, options);
  assert.equal(audio.getStatus().voiceCount, 0, 'airborne movement has no footsteps');
});

test('footstep cadence survives 120 Hz rendering with 60 Hz movement and dt-zero interactions', async () => {
  const { audio, context } = await director({ musicVolume: 0 });
  const world = game(), input = { up: true };
  audio.update(world, { active: true, input, dt: 0 });
  for (let frame = 0; frame < 120; frame++) {
    context.advance(1 / 120);
    if (frame % 2) world.player.x += 2.5;
    audio.update(world, { active: true, input, dt: 1 / 120 });
    audio.update(world, { active: true, input, dt: 0 });
  }
  const emittedSteps = context.sources.filter(source => source.buffer).length;
  assert.equal(emittedSteps, 3, 'one second of walking emits about three steps, not sixty');
  audio.dispose();
});

test('original music and finite event envelopes retire every source and disconnect their nodes', async () => {
  const { audio, context } = await director({ musicVolume: 0 });
  tick(audio, context, game());
  const names = ['enter', 'exit', 'horn', 'pop', 'hammer', 'party', 'flop', 'jump', 'crash', 'heat', 'busted', 'accept', 'checkpoint', 'complete', 'purchase', 'consume', 'style', 'escape', 'radio'];
  for (const name of names) { context.advance(0.05); assert.equal(audio.play(name, game()), true, name); }
  assert.equal(audio.play('invalid'), false); assert.ok(audio.getStatus().voiceCount > 0);
  context.advance(4); audio.update(game(), { active: true });
  assert.equal(audio.getStatus().voiceCount, 0);
  assert.ok(context.sources.every(source => source.ended && source.disconnected));
});

test('radio off silences car music and exiting returns the foot theme', async () => {
  const { audio, context } = await director({ radioStation: 'off' });
  const world = game(), ride = car('ride'); world.cars = [ride]; world.player.vehicleId = ride.id;
  tick(audio, context, world); assert.equal(audio.getStatus().station, 'off'); assert.equal(audio.getStatus().musicVoiceCount, 0);
  assert.equal(audio.getStatus().engineCount, 1);
  world.player.vehicleId = null; tick(audio, context, world);
  assert.equal(audio.getStatus().station, 'foot'); assert.ok(audio.getStatus().musicVoiceCount > 0);
});

test('station changes cancel future notes, long stalls do not schedule a backlog, and voices stay bounded', async () => {
  const { audio, context } = await director();
  const world = game(); world.cars = [car('ride')]; world.player.vehicleId = 'ride';
  for (const station of ['biscuit', 'neon', 'meadow']) {
    audio.setSettings({ radioStation: station });
    for (let step = 0; step < 650; step++) { tick(audio, context, world); assert.ok(audio.getStatus().voiceCount <= 80); }
    assert.equal(audio.getStatus().station, station); assert.ok(audio.getStatus().musicVoiceCount > 0);
    const old = context.sources.filter(source => !source.ended && source.stopTime !== undefined);
    audio.setSettings({ radioStation: 'off' }); context.advance(0.04);
    assert.ok(old.every(source => source.ended && source.disconnected));
  }
  context.advance(300); const previous = context.sources.length;
  audio.setSettings({ radioStation: 'neon' }); tick(audio, context, world);
  assert.ok(context.sources.length - previous < 30, 'tab return starts a bounded fresh beat');
  assert.equal(audio.getStatus().engineCount, 1);
});

test('pause, mute, effects zero, heat reset, and disposal stop existing layers before resuming', async () => {
  const { audio, context } = await director();
  const world = game(); world.cars = [car('ride')]; world.cars[0].speed = 130; world.player.vehicleId = 'ride'; world.heat = 2;
  world.police = [car('cop', 'compact', 50, 50)];
  tick(audio, context, world, { input: { brake: true, up: true, boost: true } });
  assert.equal(audio.getStatus().sirenCount, 1); assert.equal(audio.getStatus().engineCount, 2);
  world.heat = 0; tick(audio, context, world); assert.equal(audio.getStatus().sirenCount, 0);
  audio.update(world, { active: false }); assert.equal(audio.getStatus().voiceCount, 0); assert.equal(audio.getStatus().active, false);
  context.advance(0.05); assert.ok(context.sources.every(source => source.ended && source.disconnected));
  tick(audio, context, world); assert.ok(audio.getStatus().voiceCount > 0);
  audio.setSettings({ muted: true }); assert.equal(audio.getStatus().voiceCount, 0); assert.equal(audio.play('crash'), false);
  audio.setSettings({ muted: false, effectsVolume: 0 }); tick(audio, context, world);
  assert.equal(audio.getStatus().engineCount, 0); assert.equal(audio.getStatus().sirenCount, 0); assert.ok(audio.getStatus().musicVoiceCount > 0);
  audio.dispose(); assert.equal(audio.getStatus().state, 'disposed'); assert.equal(audio.getStatus().voiceCount, 0);
  assert.equal(await audio.unlock(), false);
});

test('embedded generated samples decode once, normalize peaks and loop edges without starting playback', async () => {
  const context = new Context(), data = samples('engine-compact', 'engine-sports', 'engine-van', 'siren', 'horn', 'crash', 'pop');
  global.MayhemAudioSamples = data;
  const audio = new AudioDirector({ contextFactory: () => context });
  delete global.MayhemAudioSamples;
  assert.equal(await audio.unlock(), true); await settleSamples();
  assert.equal(audio.getStatus().sampleCount, 7); assert.equal(audio.getStatus().loadingSamples, 0); assert.equal(audio.getStatus().failedSamples, 0);
  assert.equal(audio.getStatus().generatedVoiceCount, 0); assert.equal(context.sources.length, 0);
  const loop = audio._samples.get('engine-compact').buffer;
  for (let channel = 0; channel < loop.numberOfChannels; channel++) {
    const values = loop.getChannelData(channel);
    assert.ok([...values].every(value => Math.abs(value) <= 0.900001));
    assert.equal(values[0], 0); assert.equal(Math.abs(values.at(-1)), 0);
  }
  assert.equal(await audio.unlock(), true); await settleSamples(); assert.equal(context.decodeCalls, 7);
  audio.dispose(); assert.equal(audio.getStatus().sampleCount, 0);
});

test('corrupt sample bytes and decoder rejection preserve synthesized gameplay without retry storms', async () => {
  const context = new Context(); context.decodeAudioData = async () => { context.decodeCalls = (context.decodeCalls || 0) + 1; throw new Error('Invalid MP3'); };
  const audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 },
    sampleData: { ...samples('engine-compact', 'pop'), crash: { data: '!!! invalid !!!' } } });
  assert.equal(await audio.unlock(), true); await settleSamples();
  assert.equal(audio.getStatus().sampleCount, 0); assert.equal(audio.getStatus().failedSamples, 3); assert.equal(audio.getStatus().state, 'running');
  const world = game(); world.cars = [car('ride')]; world.player.vehicleId = 'ride'; tick(audio, context, world);
  assert.equal(audio.getStatus().engineCount, 1); assert.equal(audio.getStatus().engineSampleCount, 0); assert.equal(audio.play('pop'), true);
  assert.equal(audio.getStatus().generatedVoiceCount, 0);
  for (let i = 0; i < 10; i++) { await audio.unlock(); tick(audio, context, world); }
  assert.equal(context.decodeCalls, 2); audio.dispose();
});

test('late sample completion during pause or mute only caches data and never revives sources', async () => {
  for (const state of ['pause', 'mute', 'dispose']) {
    const context = new Context(), completions = [];
    context.decodeAudioData = () => new Promise(resolve => completions.push(resolve));
    const audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 }, sampleData: samples('engine-compact', 'siren') });
    await audio.unlock(); await settleSamples(); assert.equal(audio.getStatus().loadingSamples, 2);
    const world = game(); world.cars = [car('ride')]; world.player.vehicleId = 'ride'; world.police = [car('cop', 'compact', 40)]; world.heat = 1;
    tick(audio, context, world); assert.equal(audio.getStatus().engineSampleCount, 0);
    if (state === 'pause') audio.update(world, { active: false });
    else if (state === 'mute') audio.setSettings({ muted: true });
    else audio.dispose();
    context.advance(0.04); const sourceCount = context.sources.length;
    completions.forEach(resolve => resolve(decodedBuffer())); await settleSamples();
    assert.equal(audio.getStatus().voiceCount, 0); assert.equal(context.sources.length, sourceCount);
    assert.equal(audio.getStatus().loadingSamples, 0);
    if (state === 'dispose') { assert.equal(audio.getStatus().sampleCount, 0); continue; }
    assert.equal(audio.getStatus().sampleCount, 2);
    if (state === 'mute') audio.setSettings({ muted: false });
    tick(audio, context, world); assert.equal(audio.getStatus().engineSampleCount, 2); assert.equal(audio.getStatus().sirenSampleCount, 1);
    audio.dispose();
  }
});

test('ready loops replace synthesized layers on update and engine playback rates follow throttle smoothly', async () => {
  const context = new Context(); let complete;
  context.decodeAudioData = () => new Promise(resolve => { complete = resolve; });
  const audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 }, sampleData: samples('engine-compact') });
  await audio.unlock(); await settleSamples();
  const world = game(); world.cars = [car('ride')]; world.player.vehicleId = 'ride'; tick(audio, context, world);
  const fallbackSources = [...context.sources]; assert.equal(audio.getStatus().engineSampleCount, 0);
  complete(decodedBuffer()); await settleSamples(); assert.equal(audio.getStatus().engineSampleCount, 0);
  tick(audio, context, world); assert.equal(audio.getStatus().engineSampleCount, 1);
  const engine = audio._engines.get('ride'); assert.equal(engine.main.loop, true);
  const idle = engine.main.playbackRate.value;
  tick(audio, context, world, { input: { up: true, boost: true } }); assert.ok(engine.main.playbackRate.value > idle);
  assert.ok(engine.main.playbackRate.events.some(event => event.type === 'linear'));
  assert.ok(engine.main.playbackRate.value >= 0.5 && engine.main.playbackRate.value <= 2.5);
  context.advance(0.04); assert.ok(fallbackSources.every(source => source.ended && source.disconnected));
  for (let i = 0; i < 30; i++) {
    audio.update(world, { active: false }); context.advance(0.04); tick(audio, context, world);
    assert.equal(audio.getStatus().generatedVoiceCount, 1); assert.equal(audio.getStatus().engineSampleCount, 1);
  }
  audio.dispose(); context.advance(0.04); assert.ok(context.sources.every(source => source.ended && source.disconnected));
});

test('generated horn crash and pop events use bounded one-shot voices and retain other synthesized effects', async () => {
  const context = new Context(), audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 }, sampleData: samples('horn', 'crash', 'pop') });
  await audio.unlock(); await settleSamples(); tick(audio, context, game());
  for (const name of ['horn', 'crash', 'pop']) { context.advance(0.05); assert.equal(audio.play(name, game()), true); }
  assert.equal(audio.getStatus().generatedVoiceCount, 3); assert.equal(audio.getStatus().voiceCount, 3);
  assert.equal(audio.play('jump'), true); assert.equal(audio.getStatus().voiceCount, 4);
  assert.equal(audio.getStatus().generatedVoiceCount, 3);
  for (let i = 0; i < 150; i++) { context.advance(0.05); audio.play('pop'); assert.ok(audio.getStatus().voiceCount <= 80); }
  context.advance(2); audio.update(game(), { active: true }); assert.equal(audio.getStatus().voiceCount, 0);
  assert.ok(context.sources.every(source => source.ended && source.disconnected)); audio.dispose();
});

test('spatial materials choose distinct samples, attenuate distant impacts and bound repeated collisions per source', async () => {
  const context = new Context(), audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 },
    sampleData: samples('impact-light', 'impact-heavy', 'break-wood', 'break-metal', 'break-stone', 'break-foliage', 'explosion') });
  await audio.unlock(); await settleSamples(); const world = game(); tick(audio, context, world, { viewYaw: 0 });
  assert.equal(audio.play('crash', world, { x: 0, y: 30, material: 'wood', destroyed: true, intensity: 0.8 }), true);
  const wood = [...audio._voices].find(voice => voice.sampleKey === 'break-wood');
  assert.equal(wood.pan.pan.value, 1); assert.equal(audio.getStatus().lastPlayedSample, 'break-wood');
  assert.equal(audio.play('crash', world, { x: 0, y: 30, material: 'wood', destroyed: true, intensity: 0.8 }), false);
  assert.equal(audio.play('crash', world, { x: 0, y: -30, material: 'metal', destroyed: true, intensity: 0.8 }), true, 'different sources can collide together');
  assert.equal([...audio._voices].find(voice => voice.sampleKey === 'break-metal').pan.pan.value, -1);
  assert.equal(audio.play('crash', world, { x: 900, y: 0, material: 'stone' }), false);
  context.advance(0.2);
  audio.play('crash', world, { material: 'vehicle', intensity: 0.2 }); assert.equal(audio.getStatus().lastPlayedSample, 'impact-light');
  context.advance(0.2);
  audio.play('crash', world, { material: 'vehicle', intensity: 1 }); assert.equal(audio.getStatus().lastPlayedSample, 'impact-heavy');
  context.advance(0.2);
  audio.play('explosion', world, { x: 0, y: 0 }); assert.equal(audio.getStatus().lastPlayedSample, 'explosion');
  assert.equal(audio.getStatus().oneShotCount, 5); audio.dispose();
});

test('resident speech follows the text, preserves full lines, ducks music and avoids overlap or distant chatter', async () => {
  const context = new Context(); context.decodeAudioData = async () => ({ ...decodedBuffer(), duration: 4.88 });
  const audio = new AudioDirector({ contextFactory: () => context,
    sampleData: samples('voice-resident-2', 'voice-resident-4', 'voice-police-pursuit', 'voice-police-search') });
  await audio.unlock(); await settleSamples(); const world = game(); tick(audio, context, world);
  assert.equal(audio.play('resident', world, { x: 0, y: 25, text: "FLIPPIN' TURNIPS!" }), true);
  const speech = [...audio._voices].find(voice => voice.speech);
  assert.equal(speech.sampleKey, 'voice-resident-2'); assert.ok(speech.end - context.currentTime > 4.8);
  assert.equal(speech.pan.pan.value, 1); assert.equal(audio.getStatus().speechCount, 1);
  assert.ok(audio._music.gain.value < audio.settings.musicVolume);
  context.advance(3);
  assert.equal(audio.play('resident', world, { x: 0, y: -25, text: 'YOU ABSOLUTE WAFFLE!' }), false, 'a long line cannot overlap another');
  context.advance(2); tick(audio, context, world);
  assert.equal(audio.play('resident', world, { x: 750, y: 0, text: 'YOU ABSOLUTE WAFFLE!' }), false, 'distant residents do not clutter the mix');
  assert.equal(audio.play('resident', world, { x: 0, y: -25, text: 'YOU ABSOLUTE WAFFLE!' }), true);
  audio.update(world, { active: false }); assert.equal(audio.getStatus().speechCount, 0);
  context.advance(0.03); assert.ok(context.sources.every(source => source.ended && source.disconnected)); audio.dispose();
});

test('road contact uses terrain height and footsteps distinguish paved roads, grass and low shore sand', () => {
  const world = game(), ride = car('ride'); world.cars = [ride]; world.player.vehicleId = ride.id;
  ride.speed = 170; ride.elevation = 12; world.terrain = { surfaceHeight: () => 12, heightAt: () => 1 };
  world.network = { nearestRoad: () => ({ width: 104, distance: 65 }) }; world.districtAt = () => ({ id: 'riverfront' });
  const options = { input: { up: true, boost: true, brake: true } };
  let frame = deriveAudioFrame(world, options); assert.ok(frame.skid > 0); assert.ok(frame.road > 0); assert.ok(frame.boost > 0); assert.equal(frame.surface, 'pavement');
  ride.elevation = 12.471; frame = deriveAudioFrame(world, options); assert.ok(frame.skid > 0, 'physics ground contact remains authoritative on a slope');
  world.network.nearestRoad = () => ({ width: 104, distance: 150 }); assert.equal(deriveAudioFrame(world).surface, 'sand');
  world.terrain.heightAt = () => 5; assert.equal(deriveAudioFrame(world).surface, 'grass');
  ride.grounded = false; frame = deriveAudioFrame(world, options); assert.equal(frame.skid, 0); assert.equal(frame.road, 0); assert.equal(frame.boost, 0);
  world.police = [car('healthy'), { ...car('wreck'), health: 0 }, { ...car('burning'), burning: true }, { ...car('exploded'), exploded: true }]; world.heat = 2;
  assert.deepEqual(deriveAudioFrame(world).sirens.map(siren => siren.id), ['healthy']);
});

test('fire loops stay local and the occupied burning ride warning accelerates then stops on pause and mute', async () => {
  const context = new Context(), data = samples('fire', 'ambience-coast'); for (const asset of Object.values(data)) asset.loop = true;
  const audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 }, sampleData: data });
  await audio.unlock(); await settleSamples(); const world = game(), ride = car('ride');
  world.cars = [ride, { ...car('remote', 'van', 1000), burning: true }]; world.player.vehicleId = ride.id; ride.burning = true; ride.fireTime = 0;
  world.districtAt = () => ({ id: 'riverfront' }); tick(audio, context, world);
  assert.equal(audio.getStatus().fireCount, 1); assert.equal(audio.getStatus().ambienceCount, 1);
  const slowInterval = audio._warningAt - context.currentTime; assert.ok(slowInterval >= 1.2);
  context.advance(1.4); ride.fireTime = 7.2; tick(audio, context, world);
  assert.ok(audio._warningAt - context.currentTime < 0.4, 'warning pulses accelerate near detonation');
  audio.update(world, { active: false }); assert.equal(audio.getStatus().voiceCount, 0); assert.equal(audio.getStatus().fireCount, 0);
  tick(audio, context, world); assert.equal(audio.getStatus().fireCount, 1);
  audio.setSettings({ muted: true }); assert.equal(audio.getStatus().voiceCount, 0); assert.equal(audio.getStatus().ambienceCount, 0);
  audio.setSettings({ muted: false }); ride.burning = false; tick(audio, context, world); assert.equal(audio.getStatus().fireCount, 0); assert.equal(audio._warningId, null);
  audio.dispose();
});

test('deliberate inventory feedback survives menu frames while pause, background and mute retire every UI sound', async () => {
  const context = new Context(), audio = new AudioDirector({ contextFactory: () => context, sampleData: samples('biscuit', 'tape', 'refill') });
  await audio.unlock(); await settleSamples(); const world = game();
  audio.update(world, { active: false, allowUI: true });
  assert.equal(audio.playUI('biscuit', world), true); assert.equal(audio.getStatus().lastPlayedSample, 'biscuit');
  assert.ok(audio._master.gain.value > 0); assert.equal(audio.play('crash', world), false); assert.equal(audio.playUI('crash', world), false);
  for (let i = 0; i < 10; i++) { context.advance(0.01); audio.update(world, { active: false, allowUI: true }); }
  assert.equal(audio.getStatus().voiceCount, 1); assert.equal(audio.getStatus().musicVoiceCount, 0); assert.equal(audio.getStatus().engineCount, 0);
  audio.update(world, { active: false }); assert.equal(audio.getStatus().voiceCount, 0);
  context.advance(0.05); assert.equal(audio.playUI('tape', world), true);
  audio.setSettings({ effectsVolume: 0 }); assert.equal(audio.getStatus().voiceCount, 0);
  audio.update(world, { active: false, allowUI: true }); audio.setSettings({ effectsVolume: 0.8 });
  audio.update(world, { active: false, allowUI: true }); assert.equal(audio.getStatus().voiceCount, 0, 'restoring effects does not revive an old menu action');
  audio.setSettings({ muted: true }); assert.equal(audio.getStatus().voiceCount, 0); assert.equal(audio.playUI('refill', world), false);
  audio.setSettings({ muted: false, effectsVolume: 0 }); assert.equal(audio.playUI('refill', world), false); audio.dispose();
});

test('generated music crossfades finite voices and station IDs do not repeat at every loop', async () => {
  const context = new Context(), audio = new AudioDirector({ contextFactory: () => context,
    sampleData: samples('music-biscuit', 'voice-radio-biscuit') });
  await audio.unlock(); await settleSamples(); const world = game(); world.cars = [car('ride')]; world.player.vehicleId = 'ride';
  for (let i = 0; i < 600; i++) { tick(audio, context, world); assert.ok(audio.getStatus().musicVoiceCount <= 2); }
  assert.equal(audio.getStatus().station, 'biscuit');
  assert.equal(context.sources.filter(source => source.buffer && !source.loop && source.startTime > 1.4 && source.startTime < 1.7).length >= 1, true);
  assert.equal(audio._stationLast.size, 1);
  const speechBuffer = audio._samples.get('voice-radio-biscuit').buffer;
  assert.equal(context.sources.filter(source => source.buffer === speechBuffer).length, 1, 'one ID across many loops');
  assert.equal([...audio._voices].filter(voice => voice.speech).length, 0);
  audio.setSettings({ radioStation: 'off' }); assert.equal(audio.getStatus().musicVoiceCount, 0);
  audio.setSettings({ radioStation: 'biscuit' }); for (let i = 0; i < 120; i++) tick(audio, context, world);
  assert.equal(context.sources.filter(source => source.buffer === speechBuffer).length, 1, 'rapid radio toggles do not repeat the station ID'); audio.dispose();
});

test('quiet ambience receives bounded normalization without clipping or amplified silence', async () => {
  const context = new Context(); context.decodeAudioData = async () => {
    const data = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 7) * 0.02);
    return { duration: 0.6, sampleRate: 8000, numberOfChannels: 1, getChannelData: () => data };
  };
  const audio = new AudioDirector({ contextFactory: () => context, sampleData: { 'ambience-nature': { data: 'AQID', loop: true } } });
  await audio.unlock(); await settleSamples();
  const data = audio._samples.get('ambience-nature').buffer.getChannelData(0), peak = Math.max(...data.map(Math.abs));
  assert.ok(peak > 0.2 && peak <= 0.240001, 'a quiet loop gets at most 12 times gain'); assert.equal(data[0], 0); assert.equal(data.at(-1), 0);
  audio.dispose();
});

test('loaded engine loops blend with throttle while damage layers retire with their source and skid stays grounded', async () => {
  const context = new Context(), data = samples('engine-compact', 'engine-high-compact', 'skid'); data.skid.loop = true;
  const audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 }, sampleData: data });
  await audio.unlock(); await settleSamples(); const world = game(), ride = car('ride'); world.cars = [ride]; world.player.vehicleId = ride.id;
  tick(audio, context, world); const engine = audio._engines.get('ride'), idleBlend = engine.highGain.gain.value;
  assert.equal(engine.sources.length, 2); assert.equal(audio.getStatus().engineSampleCount, 1);
  ride.speed = 170; ride.engineHealth = 30; tick(audio, context, world, { input: { up: true, brake: true } });
  assert.ok(engine.highGain.gain.value > idleBlend); assert.ok(engine.main.playbackRate.value <= 1.65);
  assert.equal(audio._noiseLoops.get('skid').sampleKey, 'skid'); assert.ok(audio._noiseLoops.has('rattle-ride'));
  ride.grounded = false; tick(audio, context, world, { input: { brake: true } }); assert.equal(audio._noiseLoops.has('skid'), false);
  ride.exploded = true; tick(audio, context, world); assert.equal(audio._engines.size, 0); assert.equal(audio._noiseLoops.has('rattle-ride'), false);
  audio.dispose(); context.advance(0.04); assert.ok(context.sources.every(source => source.ended && source.disconnected));
});

test('police dispatch can interrupt residents and queues search only while police are still searching', async () => {
  const context = new Context(); context.decodeAudioData = async () => ({ ...decodedBuffer(), duration: 4.88 });
  const audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 },
    sampleData: samples('voice-resident-3', 'voice-police-pursuit', 'voice-police-search') });
  await audio.unlock(); await settleSamples(); const world = game(); tick(audio, context, world);
  audio.play('resident', world, { text: 'OH, CRUMBS!' }); assert.equal(audio.getStatus().lastPlayedSample, 'voice-resident-3');
  context.advance(2); world.heat = 1; world._policeSearching = true; world.policeSeen = false;
  audio.play('heat', world); assert.equal(audio.getStatus().lastPlayedSample, 'voice-police-pursuit'); assert.equal(audio.getStatus().speechCount, 1);
  audio.play('search', world); assert.equal(audio.getStatus().speechCount, 1); assert.ok(audio._pendingSearch);
  context.advance(5); tick(audio, context, world); assert.equal(audio.getStatus().lastPlayedSample, 'voice-police-search'); assert.equal(audio._pendingSearch, null);
  context.advance(5); world.heat = 2; audio.play('heat', world); audio.play('search', world); assert.ok(audio._pendingSearch);
  world.policeSeen = true; world._policeSearching = false; tick(audio, context, world); assert.equal(audio._pendingSearch, null, 'reacquiring the player discards a queued search');
  context.advance(5); world.policeSeen = false; world._policeSearching = true; audio.play('search', world); world.heat = 0;
  tick(audio, context, world); assert.equal(audio._pendingSearch, null, 'cleared heat cannot revive an old announcement'); audio.dispose();
});

test('boost attacks use the generated sample once per activation, debounce taps and do not replay a held input after pause', async () => {
  const context = new Context(), audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 }, sampleData: samples('boost') });
  await audio.unlock(); await settleSamples(); const world = game(); world.cars = [car('ride')]; world.player.vehicleId = 'ride';
  const boost = { input: { up: true, boost: true } }; tick(audio, context, world, boost);
  const buffer = audio._samples.get('boost').buffer, attacks = () => context.sources.filter(source => source.buffer === buffer).length;
  assert.equal(attacks(), 1); for (let i = 0; i < 10; i++) tick(audio, context, world, boost); assert.equal(attacks(), 1);
  tick(audio, context, world); tick(audio, context, world, boost); assert.equal(attacks(), 1, 'rapid taps are debounced');
  audio.update(world, { active: false }); context.advance(2); tick(audio, context, world, boost); assert.equal(attacks(), 1, 'held input on resume has no fresh attack');
  tick(audio, context, world); tick(audio, context, world, boost); assert.equal(attacks(), 2);
  audio.dispose(); context.advance(0.04); assert.ok(context.sources.every(source => source.ended && source.disconnected));
});

test('fire warnings and police announcements reserve room during dense ordinary effects', async () => {
  const context = new Context(), audio = new AudioDirector({ contextFactory: () => context, settings: { musicVolume: 0 },
    sampleData: samples('pop', 'voice-police-pursuit') });
  await audio.unlock(); await settleSamples(); const world = game(); tick(audio, context, world);
  const fill = () => { while (audio._hasRoom('effects')) audio._sampleVoice('pop', { level: 0.1 }); };
  fill(); assert.equal(audio.getStatus().voiceCount, 48);
  audio._updateWarning({ id: 'burning-ride', progress: 0.9 });
  assert.equal(audio.getStatus().voiceCount, 48);
  assert.equal([...audio._voices].filter(voice => voice.priority === 2).length, 2, 'ordinary debris yields to the fire warning');
  fill(); assert.equal(audio.play('heat', world), true); assert.equal(audio.getStatus().lastPlayedSample, 'voice-police-pursuit');
  assert.equal(audio.getStatus().speechCount, 1); assert.ok(audio.getStatus().voiceCount <= 48);
  audio.setSettings({ effectsVolume: 0 }); assert.equal(audio.getStatus().voiceCount, 0);
  audio.setSettings({ effectsVolume: 0.8 }); assert.equal(audio.getStatus().voiceCount, 0); audio.dispose();
});
