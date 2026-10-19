'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AircraftSystem, getModel } = require('../aircraft.js');

const planeInput = changes => ({
  pitchUp: false, pitchDown: false, rollLeft: false, rollRight: false,
  yawLeft: false, yawRight: false, throttleUp: false, throttleDown: false,
  ...changes
});

function fixture(type = 'trainer', grounded = false) {
  const game = {
    world: { mapWidth: 12000, mapHeight: 8000 },
    player: { id: 'player', vehicleId: null },
    cars: [], police: [], peds: [], buildings: [], staticObjects: [],
    heat: 0, _ground: () => 0
  };
  const aviation = new AircraftSystem(game, { spawn: false });
  const aircraft = aviation.spawn(type, { x: 6000, y: 4000, elevation: grounded ? 0 : 60 });
  const model = getModel(aircraft);
  Object.assign(aircraft, { throttle: grounded ? 0 : .7, speed: grounded ? 0 : model.maxSpeed * .7 });
  game.player.vehicleId = aircraft.id;
  Object.defineProperty(game, 'current', { get: () => aviation.current || game.player });
  return { aviation, aircraft, model };
}

function advance(aviation, seconds, input, hz = 60) {
  for (let tick = 0; tick < Math.round(seconds * hz); tick++) aviation.step(1 / hz, input);
}

test('explicit plane throttle changes persist after release and do not command pitch', () => {
  const { aviation, aircraft } = fixture();
  const height = aircraft.elevation;
  advance(aviation, .25, planeInput({ throttleUp: true }));
  assert.ok(Math.abs(aircraft.throttle - .85) < 1e-9);
  advance(aviation, .5, planeInput());
  assert.ok(Math.abs(aircraft.throttle - .85) < 1e-9);
  assert.equal(aircraft.elevation, height);
  assert.equal(aircraft.pitch, 0);
  advance(aviation, .25, planeInput({ throttleDown: true }));
  assert.ok(Math.abs(aircraft.throttle - .7) < 1e-9);
  advance(aviation, 1, planeInput({ throttleUp: true }));
  assert.equal(aircraft.throttle, 1);
  advance(aviation, 2, planeInput({ throttleDown: true }));
  assert.equal(aircraft.throttle, 0);
});

test('explicit plane pitch changes height independently of throttle and returns to level flight', () => {
  for (const [action, sign] of [['pitchUp', 1], ['pitchDown', -1]]) {
    const { aviation, aircraft } = fixture();
    const height = aircraft.elevation;
    advance(aviation, 1, planeInput({ [action]: true }));
    assert.ok((aircraft.elevation - height) * sign > 3, action);
    assert.ok(aircraft.pitch * sign > .1, action);
    assert.equal(aircraft.throttle, .7);
    assert.equal(aircraft.angle, 0);
    assert.equal(aircraft.roll, 0);
    advance(aviation, 2, planeInput());
    assert.equal(aircraft.vz, 0);
    assert.equal(aircraft.pitch, 0);
    const levelHeight = aircraft.elevation;
    advance(aviation, 1, planeInput());
    assert.equal(aircraft.elevation, levelHeight);
  }
});

test('plane banking coordinates a turn while rudder yaw leaves the wings level', () => {
  for (const [bankAction, yawAction, sign] of [['rollLeft', 'yawLeft', -1], ['rollRight', 'yawRight', 1]]) {
    const bank = fixture(), yaw = fixture();
    advance(bank.aviation, 1, planeInput({ [bankAction]: true }));
    advance(yaw.aviation, 1, planeInput({ [yawAction]: true }));
    assert.ok(bank.aircraft.roll * sign > .5, bankAction);
    assert.ok(bank.aircraft.angle * sign > .5, bankAction);
    assert.ok(yaw.aircraft.angle * sign > .4, yawAction);
    assert.equal(yaw.aircraft.roll, 0);
    assert.equal(bank.aircraft.throttle, .7);
    assert.equal(yaw.aircraft.throttle, .7);
    assert.equal(bank.aircraft.elevation, 60);
    assert.equal(yaw.aircraft.elevation, 60);
  }
});

test('plane rudder steers on the ground without banking or lifting the aircraft', () => {
  const yaw = fixture('trainer', true), bank = fixture('trainer', true);
  advance(yaw.aviation, 1, planeInput({ yawRight: true }));
  advance(bank.aviation, 1, planeInput({ rollRight: true }));
  assert.ok(yaw.aircraft.angle > 1);
  assert.equal(yaw.aircraft.roll, 0);
  assert.equal(yaw.aircraft.grounded, true);
  assert.equal(bank.aircraft.angle, 0);
  assert.equal(bank.aircraft.roll, 0);
});

test('opposing explicit plane controls cancel instead of changing axes or throttle', () => {
  const { aviation, aircraft } = fixture();
  advance(aviation, 1, planeInput({
    pitchUp: true, pitchDown: true, rollLeft: true, rollRight: true,
    yawLeft: true, yawRight: true, throttleUp: true, throttleDown: true
  }));
  assert.equal(aircraft.throttle, .7);
  assert.equal(aircraft.angle, 0);
  assert.equal(aircraft.roll, 0);
  assert.equal(aircraft.pitch, 0);
  assert.equal(aircraft.elevation, 60);
});

test('explicit plane controls take precedence over shared movement and boost aliases', () => {
  const { aviation, aircraft, model } = fixture();
  aircraft.throttle = 1; aircraft.speed = model.maxSpeed;
  advance(aviation, 1, planeInput({ up: true, right: true, climb: true, jump: true, boost: true }));
  assert.equal(aircraft.speed, model.maxSpeed);
  assert.equal(aircraft.angle, 0);
  assert.equal(aircraft.roll, 0);
  assert.equal(aircraft.elevation, 60);
});

test('explicit plane controls retain automatic takeoff and low-speed stall descent', () => {
  const { aviation, aircraft } = fixture('trainer', true);
  advance(aviation, 4, planeInput({ throttleUp: true }));
  assert.equal(aircraft.throttle, 1);
  assert.equal(aircraft.grounded, false);
  assert.ok(aircraft.elevation > 0);
  Object.assign(aircraft, { elevation: 60, speed: 25, throttle: 0, vz: 0 });
  advance(aviation, 2, planeInput({ pitchUp: true }));
  assert.equal(aircraft.stalled, true);
  assert.equal(aircraft.stallWarning, true);
  assert.ok(aircraft.elevation < 55);
});

test('legacy plane and helicopter commands keep their established behavior', () => {
  const plane = fixture('trainer', true);
  advance(plane.aviation, 7, { up: true, climb: true });
  assert.ok(plane.aircraft.elevation > 25);
  const heading = plane.aircraft.angle;
  advance(plane.aviation, 1, { right: true });
  assert.ok(plane.aircraft.angle > heading + .4);
  assert.ok(plane.aircraft.roll > .4);

  const heli = fixture('helicopter', true);
  advance(heli.aviation, 2, { ...planeInput(), climb: true });
  assert.ok(heli.aircraft.elevation > 10);
  advance(heli.aviation, 2, { ...planeInput(), up: true });
  const speed = heli.aircraft.speed;
  advance(heli.aviation, 1, { ...planeInput(), hover: true });
  assert.ok(heli.aircraft.speed < speed * .3);
});

test('explicit plane control results agree across supported input step rates', () => {
  const results = [30, 60, 120].map(hz => {
    const { aviation, aircraft } = fixture();
    advance(aviation, 1, planeInput({ throttleUp: true, pitchUp: true, rollRight: true, yawLeft: true }), hz);
    return { throttle: aircraft.throttle, angle: aircraft.angle, roll: aircraft.roll, elevation: aircraft.elevation };
  });
  for (const actual of results.slice(1)) for (const key of Object.keys(actual)) {
    assert.ok(Math.abs(actual[key] - results[0][key]) < .1, key + ' is stable across input step rates');
  }
});
