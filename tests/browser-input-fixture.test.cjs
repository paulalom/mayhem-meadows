'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { installBrowserInputFixture } = require('../tools/browser-input-fixture.cjs');
const { createTestContext, closeTestContext } = require('../tools/browser-check.cjs');

function isolatedPage() {
  const nativeCalls = [];
  class Element extends EventTarget {
    getBoundingClientRect() { return { x: 20, y: 30, width: 400, height: 200 }; }
  }
  class HTMLElement extends Element {}
  class HTMLCanvasElement extends HTMLElement {}
  class Document extends EventTarget {}
  class PointerEvent extends Event {
    constructor(type, options) {
      super(type, options);
      for (const key of ['clientX', 'clientY', 'pointerType', 'pointerId']) this[key] = options[key];
    }
  }
  Object.defineProperty(Element.prototype, 'requestPointerLock', { configurable: true, value() { nativeCalls.push('request'); throw new Error('Native capture must never execute.'); } });
  Object.defineProperty(Document.prototype, 'exitPointerLock', { configurable: true, value() { nativeCalls.push('exit'); } });
  Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { nativeCalls.push('state'); return null; } });
  const document = new Document(), canvas = new HTMLCanvasElement();
  const sandbox = { Element, HTMLElement, HTMLCanvasElement, Document, document, Event, PointerEvent, Promise, queueMicrotask };
  vm.createContext(sandbox);
  const install = () => vm.runInContext(`(${installBrowserInputFixture.toString()})()`, sandbox);
  return { sandbox, document, canvas, Element, Document, nativeCalls, install };
}

test('virtual pointer capture replaces native methods and prototype access without desktop side effects', async () => {
  const page = isolatedPage(); page.install();
  const changes = [];
  page.document.addEventListener('pointerlockchange', () => changes.push(page.document.pointerLockElement));
  assert.equal(page.sandbox.__browserInputFixture.assertSafe(), true);
  assert.equal(page.document.pointerLockElement, null);
  await page.canvas.requestPointerLock();
  assert.equal(page.document.pointerLockElement, page.canvas);
  assert.equal(Object.getOwnPropertyDescriptor(page.Document.prototype, 'pointerLockElement').get.call(page.document), page.canvas);
  page.document.exitPointerLock(); await Promise.resolve();
  assert.equal(page.document.pointerLockElement, null);
  assert.deepEqual(changes, [page.canvas, null]);
  await page.Element.prototype.requestPointerLock.call(page.canvas);
  page.Document.prototype.exitPointerLock.call(page.document); await Promise.resolve();
  assert.deepEqual(page.nativeCalls, []);
  assert.throws(() => Object.defineProperty(page.Element.prototype, 'requestPointerLock', { value() {} }), TypeError, 'Capture interception cannot be replaced accidentally.');
});

test('relative input reaches a captured element with finite deltas and viewport coordinates', async () => {
  const page = isolatedPage(); page.install();
  const fixture = page.sandbox.__browserInputFixture, moves = [];
  page.canvas.addEventListener('pointermove', event => moves.push({ dx: event.movementX, dy: event.movementY, x: event.clientX, y: event.clientY, pointer: event.pointerType }));
  assert.throws(() => fixture.relativeMove(page.canvas, 20, -8), /simulated pointer capture/);
  await page.canvas.requestPointerLock();
  fixture.relativeMove(page.canvas, 20, -8);
  assert.deepEqual(moves, [{ dx: 20, dy: -8, x: 220, y: 130, pointer: 'mouse' }]);
  assert.throws(() => fixture.relativeMove(page.canvas, Infinity, 0), /finite/);
  fixture.release(); await Promise.resolve();
  assert.equal(page.document.pointerLockElement, null);
  assert.equal(fixture.stats.relativeMoves, 1);
  assert.deepEqual(page.nativeCalls, []);
});

test('fixture reinstall is safe and vendor-prefixed capture aliases stay virtual', async () => {
  const page = isolatedPage(); page.install();
  const original = page.sandbox.__browserInputFixture;
  page.install();
  assert.equal(page.sandbox.__browserInputFixture, original);
  await page.canvas.webkitRequestPointerLock();
  assert.equal(page.document.webkitPointerLockElement, page.canvas);
  page.document.mozExitPointerLock(); await Promise.resolve();
  assert.equal(page.document.mozPointerLockElement, null);
  assert.deepEqual(page.nativeCalls, []);
});

test('context factory installs interception before a page exists and cleanup always closes', async () => {
  const order = [];
  const context = {
    async addInitScript(fn) { assert.equal(fn, installBrowserInputFixture); order.push('fixture'); },
    pages() { return [{ async evaluate() { order.push('release'); throw new Error('Page already closed.'); } }]; },
    async close() { order.push('close'); },
  };
  const browser = { async newContext(options) { assert.equal(options.serviceWorkers, 'block'); order.push('context'); return context; } };
  assert.equal(await createTestContext(browser, { serviceWorkers: 'block' }), context);
  assert.deepEqual(order, ['context', 'fixture']);
  await closeTestContext(context);
  assert.deepEqual(order, ['context', 'fixture', 'release', 'close']);
});

test('context creation fails closed when pointer interception cannot be installed', async () => {
  let closed = false;
  const browser = { async newContext() { return {
    async addInitScript() { throw new Error('Fixture installation failed.'); },
    async close() { closed = true; },
  }; } };
  await assert.rejects(createTestContext(browser, {}), /Fixture installation failed/);
  assert.equal(closed, true);
});
