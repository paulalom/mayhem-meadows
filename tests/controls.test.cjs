'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const controls = require('../controls.js');
const input = (settings, group, ...keys) => controls.readInput(settings, group, new Set(keys));

test('each vehicle resolves to the right control set', () => {
  assert.equal(controls.groupFor({ id: 'player' }), 'foot');
  assert.equal(controls.groupFor({ kind: 'van' }), 'car');
  assert.equal(controls.groupFor({ kind: 'tank' }), 'tank');
  for (const type of ['helicopter', 'news', 'policeheli', 'transportheli']) assert.equal(controls.groupFor({ kind: 'aircraft', aircraftType: type }), 'helicopter');
  for (const type of ['trainer', 'commuter', 'fighter']) assert.equal(controls.groupFor({ kind: 'aircraft', aircraftType: type }), 'plane');
});

test('car, helicopter and foot defaults retain existing keys and both modifier sides', () => {
  const settings = controls.normalizeSettings();
  const car = input(settings, 'car', 'KeyW', 'KeyA', 'Space', 'ShiftRight');
  assert.ok(car.up && car.left && car.brake && car.boost);
  assert.ok(input(settings, 'tank', 'Space', 'ShiftRight').brake);
  assert.ok(input(settings, 'tank', 'Space', 'ShiftRight').boost);
  const heli = input(settings, 'helicopter', 'ArrowUp', 'ArrowRight', 'Space', 'ControlRight', 'ShiftRight');
  assert.ok(heli.up && heli.right && heli.climb && heli.descend && heli.hover);
  assert.ok(input(settings, 'foot', 'Space').jump);
  assert.equal(controls.actionForKey(settings, 'helicopter', 'KeyE'), 'interact');
});

test('flight axes map WS pitch, AD roll, QE yaw and Shift/Space throttle without aliases', () => {
  const settings = controls.normalizeSettings();
  for (const [key, action] of Object.entries({ KeyW: 'pitchDown', KeyS: 'pitchUp', KeyA: 'rollLeft', KeyD: 'rollRight', KeyQ: 'yawLeft', KeyE: 'yawRight', ShiftRight: 'throttleUp', Space: 'throttleDown', KeyX: 'interact' })) {
    const command = input(settings, 'plane', key);
    assert.deepEqual(Object.keys(command).filter(id => command[id]), [action]);
    assert.equal(command.up, undefined); assert.equal(command.climb, undefined); assert.equal(command.boost, undefined);
  }
  assert.equal(input(settings, 'plane').rollLeft, false, 'explicit plane mode remains identifiable when idle');
});

test('presets can be chosen independently and classic plane inputs remain available', () => {
  const settings = controls.normalizeSettings();
  assert.ok(controls.setPreset(settings, 'plane', 'legacy'));
  assert.ok(input(settings, 'plane', 'KeyW', 'Space', 'ShiftLeft').up);
  assert.ok(input(settings, 'plane', 'KeyW', 'Space', 'ShiftLeft').climb);
  assert.equal(controls.actionForKey(settings, 'plane', 'KeyE'), 'interact');
  assert.ok(controls.setPreset(settings, 'car', 'arrows'));
  assert.equal(input(settings, 'car', 'KeyW').up, false);
  assert.equal(input(settings, 'car', 'ArrowUp').up, true);
  assert.equal(input(settings, 'helicopter', 'KeyW').up, true);
  assert.equal(controls.setPreset(settings, 'plane', 'invalid'), false);
});

test('rebinding isolates contexts, detects conflicts and protects menu shortcuts', () => {
  const settings = controls.normalizeSettings();
  assert.ok(controls.rebind(settings, 'car', 'up', 'KeyT').ok);
  assert.equal(input(settings, 'car', 'KeyW').up, false);
  assert.equal(input(settings, 'car', 'KeyT').up, true);
  assert.equal(input(settings, 'helicopter', 'KeyW').up, true);
  assert.match(controls.rebind(settings, 'car', 'down', 'KeyT').error, /already used/);
  for (const code of ['Escape', 'Tab', 'KeyP', 'KeyM', 'KeyI', 'KeyG', 'F5', 'MetaLeft', 'AltLeft', '', null]) assert.ok(controls.rebind(settings, 'car', 'down', code).error);
  assert.match(controls.rebind(settings, 'car', 'brake', 'ShiftRight').error, /already used/, 'canonical modifier sides cannot conflict');
  controls.setPreset(settings, 'car', 'standard');
  assert.equal(input(settings, 'car', 'KeyW').up, true);
});

test('custom layouts and presets survive JSON saves; malformed data falls back atomically', () => {
  const settings = controls.normalizeSettings();
  controls.setPreset(settings, 'plane', 'legacy');
  controls.rebind(settings, 'plane', 'climb', 'KeyT');
  assert.deepEqual(controls.normalizeSettings(JSON.parse(JSON.stringify(settings))), settings);
  for (const value of [null, [], 7, 'bad', { car: { preset: '__proto__', bindings: { up: ['Escape'] } } }, { car: { bindings: { up: ['KeyS'] } } }, { car: { bindings: { up: [null] } } }, { plane: { bindings: { rollLeft: [] } } }]) assert.deepEqual(controls.normalizeSettings(value), controls.normalizeSettings());
});
