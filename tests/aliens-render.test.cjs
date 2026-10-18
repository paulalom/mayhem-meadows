'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ console, AbortController });
for (const file of ['vendor/three.min.js', 'scene3d.js', 'aliens-render.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
const T = context.THREE, Render = context.MayhemAlienRender;
function fixture() {
  const scene = Object.create(context.MayhemScene.prototype);
  Object.assign(scene, { T, scene: new T.Scene(), _materials: new Map(), _geometries: [], _residents: new Map(),
    game: { peds: [], aliens: { time: 0, saucer: { visible: true, phase: 'beam', x: 4000, y: 3000, elevation: 25, angle: .4, beam: 1 }, capture: null } },
    canvas: { dataset: {} }, _worldInfo: {}, reducedMotion: false });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  scene._sphere = scene._geometry(new T.IcosahedronGeometry(1, 1));
  scene._cylinder = scene._geometry(new T.CylinderGeometry(1, 1, 1, 12));
  scene._cone = scene._geometry(new T.ConeGeometry(1, 1, 7));
  return scene;
}
function finiteModel(group) {
  group.updateMatrixWorld(true); let meshes = 0;
  group.traverse(node => {
    if (!node.isMesh) return; meshes++;
    assert.ok(Array.from(node.geometry.attributes.position.array).every(Number.isFinite));
    assert.ok(node.matrixWorld.elements.every(Number.isFinite));
  });
  assert.ok(meshes > 4);
}

test('disguised alien and bare pilot use the same head with distinct visible costume geometry', () => {
  const scene = fixture(), disguised = Render.character(scene, true), pilot = Render.character(scene, false);
  assert.ok(disguised.costume); assert.equal(pilot.costume, null);
  assert.deepEqual(disguised.head.scale.toArray(), pilot.head.scale.toArray());
  assert.ok(disguised.costume.name.includes('Taped moustache'));
  finiteModel(disguised.group); finiteModel(pilot.group);
  const bounds = new T.Box3().setFromObject(pilot.group), size = bounds.getSize(new T.Vector3());
  assert.ok(size.y > 1.7 && size.y < 2); assert.ok(size.y > size.z * 3);
});

test('classic saucer has clear glazing and an actual undisguised pilot inside the cockpit', () => {
  const scene = fixture(), model = Render.saucer(scene);
  assert.equal(model.window.material.transparent, true); assert.ok(model.window.material.opacity < .3);
  assert.equal(model.window.material.depthWrite, false); assert.equal(model.pilot.costume, null);
  assert.equal(model.pilot.group.parent, model.group);
  model.group.updateMatrixWorld(true);
  const headPosition = model.pilot.head.getWorldPosition(new T.Vector3());
  assert.ok(headPosition.y > 1 && headPosition.y < 2.33);
  const hull = new T.Box3().setFromObject(model.group).getSize(new T.Vector3());
  assert.ok(hull.x > 8 && hull.x > hull.y * 1.8);
  finiteModel(model.group);
});

test('repeated visits reuse one saucer, beam and geometry; paused/reduced motion stays stable', () => {
  const scene = fixture(); Render.update(scene);
  const model = scene._alienSaucer, geometryCount = scene._geometries.length;
  for (let i = 0; i < 20; i++) { scene.game.aliens.time += .2; Render.update(scene); }
  assert.equal(scene._alienSaucer, model); assert.equal(scene._geometries.length, geometryCount);
  assert.equal(model.beam.visible, true); assert.equal(scene.canvas.dataset.abductionBeam, 'true');
  scene.reducedMotion = true; Render.update(scene);
  const before = model.rings.map(ring => ring.position.toArray());
  scene.game.aliens.time += 10; Render.update(scene);
  assert.deepEqual(model.rings.map(ring => ring.position.toArray()), before); assert.equal(model.group.rotation.z, 0);
  scene.game.aliens.saucer.visible = false; scene.game.aliens.saucer.beam = 0; Render.update(scene);
  assert.equal(model.group.visible, false); assert.ok(model.rings.every(ring => !ring.visible)); assert.equal(model.beam.visible, false);
});
