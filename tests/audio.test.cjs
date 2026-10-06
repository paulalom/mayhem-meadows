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
  constructor(context) { this.context = context; this.connected = false; this.disconnected = false; context.nodes.push(this); }
  connect() { this.connected = true; }
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
