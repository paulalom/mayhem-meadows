'use strict';

// This function is installed before page scripts in isolated automation contexts.
// It never retains or calls Chrome's native pointer-lock methods: native lock in
// a hidden Chrome window can confine the user's actual desktop cursor.
// Normal game pages continue to use the browser's real pointer-lock API.
function installBrowserInputFixture() {
  if (globalThis.__browserInputFixture) return;
  let lockedElement = null, ready = false;
  const stats = { requests: 0, exits: 0, relativeMoves: 0 };
  const requestNames = ['requestPointerLock', 'webkitRequestPointerLock', 'mozRequestPointerLock'];
  const exitNames = ['exitPointerLock', 'webkitExitPointerLock', 'mozExitPointerLock'];
  const getterNames = ['pointerLockElement', 'webkitPointerLockElement', 'mozPointerLockElement'];
  const prototypes = [globalThis.HTMLCanvasElement?.prototype, globalThis.HTMLElement?.prototype, Element.prototype].filter(Boolean);
  const notify = () => queueMicrotask(() => document.dispatchEvent(new Event('pointerlockchange')));
  const getLockedElement = () => lockedElement;

  function requestPointerLock() {
    if (!ready) return Promise.reject(new Error('The automated pointer fixture is not ready.'));
    stats.requests++;
    lockedElement = this;
    notify();
    return Promise.resolve();
  }

  function exitPointerLock() {
    if (!lockedElement) return;
    stats.exits++;
    lockedElement = null;
    notify();
  }

  // Intercept capture first. If any later fixture setup fails, these guarded
  // replacements reject instead of allowing a native desktop cursor grab.
  for (const prototype of prototypes) for (const name of requestNames) {
    Object.defineProperty(prototype, name, { value: requestPointerLock, configurable: false, writable: false });
  }
  for (const owner of [Document.prototype, document]) {
    for (const name of exitNames) Object.defineProperty(owner, name, { value: exitPointerLock, configurable: false, writable: false });
    for (const name of getterNames) Object.defineProperty(owner, name, { get: getLockedElement, configurable: false });
  }

  function assertSafe() {
    if (!ready) throw new Error('The automated pointer fixture is not ready.');
    for (const prototype of prototypes) for (const name of requestNames) {
      if (prototype[name] !== requestPointerLock) throw new Error('Native pointer capture is not intercepted.');
    }
    for (const owner of [Document.prototype, document]) {
      for (const name of exitNames) if (owner[name] !== exitPointerLock) throw new Error('Native pointer exit is not intercepted.');
      for (const name of getterNames) if (Object.getOwnPropertyDescriptor(owner, name)?.get !== getLockedElement) throw new Error('Native pointer state is not intercepted.');
    }
    return true;
  }

  function relativeMove(element, dx, dy) {
    assertSafe();
    if (lockedElement !== element) throw new Error('Relative test movement needs simulated pointer capture.');
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Relative movement must be finite.');
    const bounds = element.getBoundingClientRect();
    const event = new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 1,
      clientX: bounds.x + bounds.width / 2, clientY: bounds.y + bounds.height / 2 });
    Object.defineProperties(event, { movementX: { value: dx }, movementY: { value: dy } });
    stats.relativeMoves++;
    element.dispatchEvent(event);
  }

  ready = true;
  Object.defineProperty(globalThis, '__browserInputFixture', { value: Object.freeze({
    pointerLockMode: 'virtual-pointer-lock', relativeInputMode: 'DOM PointerEvent',
    assertSafe, relativeMove, release: exitPointerLock,
    get stats() { return { ...stats }; },
  }), configurable: false, writable: false });
  assertSafe();
}

module.exports = { installBrowserInputFixture };
