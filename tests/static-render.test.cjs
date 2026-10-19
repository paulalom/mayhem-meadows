'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ console, AbortController });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scene3d.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../trains-render.js'), 'utf8'), context);
const { THREE: T, MayhemScene: Scene3D } = context;
function fixture() {
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, { T, scene: new T.Scene(), game: { staticObjects: [] }, _materials: new Map(), _geometries: [],
    _staticParts: new Map(), _propRenderStates: new Map(), _propInstances: [], _sun: new T.DirectionalLight() });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  return scene;
}

test('static paint batches preserve every vertex color, transform, triangle and shadow category', () => {
  const scene = fixture(), red = scene._material('#c45244'), blue = scene._material('#447fc4');
  scene._static(scene._cube, red, 2, 3, 4, 1, 2, 3);
  scene._static(scene._cube, blue, 8, 3, 4, 1, 2, 3);
  scene._static(scene._cube, red, 12, 3, 4, 1, 2, 3, null, false);
  scene._static(scene._cube, scene._material('#abcdef', { unlit: true }), 15, 3, 4, 1, 2, 3);
  scene._static(scene._cube, scene._material('#abcdef', { opacity: .5 }), 18, 3, 4, 1, 2, 3);
  scene._bakeStatics();
  const meshes = scene.scene.children.filter(object => object.isMesh);
  assert.equal(meshes.length, 4, 'two opaque paints share one draw while distinct shading modes remain separate');
  const merged = meshes.find(mesh => mesh.material.vertexColors && mesh.castShadow);
  assert.ok(merged);
  assert.equal(merged.geometry.index.count, scene._cube.index.count * 2);
  const colors = merged.geometry.attributes.color, positions = merged.geometry.attributes.position, count = scene._cube.attributes.position.count;
  for (let i = 0; i < colors.count; i++) {
    const expected = i < count ? red.color : blue.color;
    for (const [axis, value] of [['X', expected.r], ['Y', expected.g], ['Z', expected.b]]) assert.ok(Math.abs(colors['get' + axis](i) - value) < 1e-7);
    const source = i % count;
    assert.equal(positions.getX(i), scene._cube.attributes.position.getX(source) + (i < count ? 2 : 8));
    assert.equal(positions.getY(i), scene._cube.attributes.position.getY(source) * 2 + 3);
    assert.equal(positions.getZ(i), scene._cube.attributes.position.getZ(source) * 3 + 4);
  }
  assert.equal(meshes.find(mesh => mesh.material.vertexColors && !mesh.castShadow).geometry.index.count, scene._cube.index.count);
  assert.ok(meshes.some(mesh => mesh.material.isMeshBasicMaterial));
  assert.ok(meshes.some(mesh => mesh.material.transparent && mesh.material.opacity === .5));
});

test('fixed world transforms stay cached while lights and subsequently added actors still move', () => {
  const scene = fixture(), group = new T.Group(), fixed = new T.Mesh(scene._cube, scene._material('#ffffff'));
  group.position.set(10, 2, 3); fixed.position.set(1, 2, 3); group.add(fixed);
  scene.scene.add(group, scene._sun, scene._sun.target);
  scene._freezeStaticWorld();
  const matrix = fixed.matrixWorld.clone();
  let recomposed = 0;
  fixed.updateMatrix = () => recomposed++;
  const actor = new T.Mesh(scene._cube, scene._material('#123456')); scene.scene.add(actor);
  actor.position.set(20, 5, 8); scene._sun.position.set(30, 40, 50); scene._sun.target.position.set(4, 5, 6);
  scene.scene.updateMatrixWorld();
  assert.equal(recomposed, 0);
  assert.ok(fixed.matrixWorld.equals(matrix));
  assert.equal(actor.matrixWorld.elements[12], 20);
  assert.equal(scene._sun.matrixWorld.elements[12], 30);
  assert.equal(scene._sun.target.matrixWorld.elements[12], 4);
});

test('the repair shutter still moves after static world transforms are frozen', () => {
  const scene = fixture(), garage = { serviceId: 'repair', x: 800, y: 600, elevation: 2, angle: .5 };
  scene._makeGarageDoor(garage); scene._freezeStaticWorld();
  const door = scene._garageDoors.get('repair');
  assert.equal(door.group.visible, false);
  scene.game.garageService = { serviceId: 'repair' };
  for (const closed of [.35, 1, .1]) {
    scene.game.garageTransition = { door: closed }; scene._garageDoorStep(); scene.scene.updateMatrixWorld(true);
    assert.equal(door.group.visible, true); assert.equal(door.group.userData.closed, closed);
    const bounds = new T.Box3();
    for (const panel of door.panels) if (panel.visible) bounds.union(new T.Box3().setFromObject(panel));
    const raisedBottom = garage.elevation + 4 * (1 - closed);
    assert.ok(bounds.min.y >= raisedBottom - .001 && bounds.min.y <= raisedBottom + .03,
      'rendered shutter bottom follows its raised height after static transforms freeze');
    assert.ok(Math.abs(bounds.max.y - (garage.elevation + 4)) < .03);
  }
  scene.game.garageService = null; scene.game.garageTransition = null;
  scene._garageDoorStep(); assert.equal(door.group.visible, false); assert.equal(door.group.userData.closed, 0);
});

test('crossing stripes share one mesh per arm while hinge motion, paint and warning lights stay intact', () => {
  const scene = fixture(), gate = { width: 104, progress: .25, state: 'closing', stopLines: [{ x: 4000, y: 4000, angle: 0 }] };
  scene._sphere = scene._geometry(new T.IcosahedronGeometry(1, 1));
  scene.game = { railTraffic: { cars: [], gates: [gate], time: 0 }, world: { sidewalkWidth: 32, terrain: { heightAt: () => 2 } } };
  context.MayhemTrainRender.step(scene);
  assert.equal(scene._trains.arms.length, 2);
  const stripes = Math.ceil((gate.width / 2 + 32 + 12) / 20 / .35);
  for (const item of scene._trains.arms) {
    assert.equal(item.arm.children.length, 1);
    const mesh = item.arm.children[0];
    assert.equal(mesh.geometry.index.count, scene._cube.index.count * stripes);
    assert.equal(mesh.castShadow, true); assert.equal(mesh.receiveShadow, false);
    assert.equal(item.arm.rotation.z, .75 * Math.PI / 2);
    const colors = mesh.geometry.attributes.color;
    for (let stripe = 0; stripe < stripes; stripe++) {
      const color = new T.Color(stripe % 2 ? '#f3edd8' : '#b85f55'), index = stripe * scene._cube.attributes.position.count;
      assert.ok(Math.abs(colors.getX(index) - color.r) < 1e-7);
      assert.ok(Math.abs(colors.getY(index) - color.g) < 1e-7);
      assert.ok(Math.abs(colors.getZ(index) - color.b) < 1e-7);
    }
  }
  gate.progress = 1; gate.state = 'open'; context.MayhemTrainRender.step(scene);
  scene.scene.updateMatrixWorld(true);
  for (const item of scene._trains.arms) { assert.equal(item.arm.rotation.z, 0); assert.equal(item.light.visible, false); }
});
