'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');

const document = {
  createElement() {
    return { getContext: () => ({ fillRect() {}, fillText() {}, measureText: text => ({ width: String(text).length * 20 }) }) };
  }
};
const context = vm.createContext({ MayhemCore: core, MayhemWorld: require('../world.js'), document, console, AbortController });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../vendor/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scene3d.js'), 'utf8'), context);
const { THREE: T, MayhemScene: Scene3D } = context;

function makeScene(game = new core.Game({ seed: 42 })) {
  const scene = Object.create(Scene3D.prototype);
  Object.assign(scene, {
    T, game, scene: new T.Scene(), canvas: { dataset: {} },
    _geometries: [], _materials: new Map(), _textures: [], _staticParts: new Map(),
    _propVolumes: [], _propAimMeshes: [], _buildingVolumes: [],
    _color: new T.Color(), _dummy: new T.Object3D(), _residents: new Map(), _vehicles: new Map(),
    width: 1280, height: 720, camera: new T.PerspectiveCamera(57, 1280 / 720, .06, 175),
    _ray: new T.Raycaster(), _pointer: new T.Vector2(),
    _ground: new T.Plane(new T.Vector3(0, 1, 0), 0), _aimPoint: new T.Vector3(),
    _aimBox: new T.Box3(), _aimHit: new T.Vector3(), _localAimRay: new T.Ray()
  });
  scene._cube = scene._geometry(new T.BoxGeometry(1, 1, 1));
  scene._sphere = scene._geometry(new T.IcosahedronGeometry(1, 1));
  scene._cylinder = scene._geometry(new T.CylinderGeometry(1, 1, 1, 12));
  scene._cone = scene._geometry(new T.ConeGeometry(1, 1, 7));
  return scene;
}

function matrixOf(slot) {
  const matrix = new T.Matrix4();
  slot.mesh.getMatrixAt(slot.index, matrix);
  return matrix;
}

test('destruction removes all owned prop parts and signs while reusing shared batches', () => {
  const scene = makeScene(), objects = scene.game.staticObjects;
  const planter = { kind: 'planter', x: 100, y: 100, parts: [{ offset: [0, .3, 0], half: [.6, .3, .3] }] };
  objects.push(planter);
  scene._physicalProps();
  scene._staticBox('#a7c991', 5, -.15, 5, 10, .3, 10);
  scene._bakeStatics();
  assert.ok(scene._propInstances.length < 32, 'prop parts use a bounded set of shared material/shape batches');
  assert.ok(scene._propInstances.length < objects.length);
  for (const object of objects.filter(object => object.destructible !== false)) {
    assert.ok(scene._propRenderStates.get(object).slots.length >= object.parts.length, object.kind + ' owns all physical parts');
  }
  const tree = objects.find(object => object.kind === 'tree');
  const fountain = objects.find(object => object.kind === 'fountain');
  const wayfinding = objects.find(object => object.kind === 'wayfinding');
  const wash = objects.find(object => object.kind === 'wash');
  assert.equal(scene._propRenderStates.get(tree).slots.length, tree.parts.length + 2, 'tree owns both canopy shapes');
  assert.equal(scene._propRenderStates.get(fountain).slots.length, fountain.parts.length + 2, 'fountain owns its water and spray');
  assert.equal(scene._propRenderStates.get(planter).slots.length, planter.parts.length + 3, 'planter owns foliage and flowers');
  const garage = objects.find(object => object.kind === 'garage');
  assert.equal(scene._propRenderStates.has(garage), false, 'garage building stays in permanent static geometry');
  for(const platform of objects.filter(object=>object.kind==='rail-platform'))assert.equal(scene._propRenderStates.has(platform),false,'station structures stay in permanent static geometry');
  const permanentMeshes = scene.scene.children.filter(mesh => mesh.isMesh && !mesh.isInstancedMesh && !mesh.material.map);
  const permanentBuffers = permanentMeshes.map(mesh => Array.from(mesh.geometry.attributes.position.array));
  const meshes = [...scene._propInstances], geometryCount = scene._geometries.length, materialCount = scene._materials.size;
  const destroyed = [tree, fountain, wayfinding, wash, planter];
  for (const object of destroyed) object.destroyed = true;
  for (let i = 0; i < 60; i++) scene._syncDestructibleProps();
  for (const object of destroyed) {
    const state = scene._propRenderStates.get(object);
    for (const slot of state.slots) assert.equal(matrixOf(slot).determinant(), 0, object.kind + ' geometry disappears');
    for (const sign of state.signs) assert.equal(sign.visible, false, object.kind + ' sign disappears');
  }
  assert.equal(scene._propRenderStates.get(wayfinding).signs.length, 1);
  assert.equal(scene._propRenderStates.get(wash).signs.length, 1);
  for (const object of objects.filter(object => !object.destroyed && object.destructible !== false)) {
    for (const slot of scene._propRenderStates.get(object).slots) assert.ok(matrixOf(slot).determinant() > 0, 'neighboring prop remains visible');
  }
  assert.equal(scene._propInstances.length, meshes.length);
  for (let i = 0; i < meshes.length; i++) assert.equal(scene._propInstances[i], meshes[i]);
  assert.equal(scene._geometries.length, geometryCount);
  assert.equal(scene._materials.size, materialCount);
  assert.deepEqual(permanentMeshes.map(mesh => Array.from(mesh.geometry.attributes.position.array)), permanentBuffers, 'terrain and garage are unchanged');
  assert.equal(scene.canvas.dataset.destroyedProps, '5');
  assert.equal(Number(scene.canvas.dataset.liveProps), objects.length - 5);
});

test('destroyed props stop intercepting crosshair rays immediately and owned camera volumes are ignored', () => {
  const object = { kind: 'bench', x: 0, y: 0, parts: [{ offset: [0, 1, 0], half: [.5, .5, .5] }] };
  const scene = makeScene({ staticObjects: [object] });
  scene._physicalProps(); scene._bakeStatics();
  scene.camera.position.set(0, 1, 5); scene.camera.lookAt(0, 1, 0); scene.camera.updateMatrixWorld();
  assert.equal(scene._aimWorldPoint(640, 360), true);
  assert.ok(Math.abs(scene._aimPoint.z - .5) < .000001);
  scene._buildingVolumes = [scene._propVolumes[0]];
  assert.ok(scene._boomFraction(0, 1, 5, 0, 1, -5) < 1);
  assert.equal(scene._insideBuilding(0, 1, 0), true);
  scene._buildingVolumes = [];
  object.destroyed = true;
  assert.equal(scene._aimWorldPoint(640, 360), false, 'no render frame is needed to release the destroyed aiming obstacle');
  scene._buildingVolumes = [scene._propVolumes[0]];
  assert.equal(scene._boomFraction(0, 1, 5, 0, 1, -5), 1);
  assert.equal(scene._insideBuilding(0, 1, 0), false);
});

test('debris uses one capped reusable batch and shrinks away at the end of its lifetime', () => {
  const scene = makeScene({ staticObjects: [], debris: [] });
  scene._debrisEffects();
  assert.equal(scene._debris, undefined, 'no debris mesh is needed before the first destruction');
  const piece = { x: 100, y: 200, elevation: 2, angle: .3, spin: 4, size: [.4, .2, .3], color: '#a88462', life: 2, maxLife: 2 };
  scene.game.debris = Array.from({ length: 180 }, (_, i) => ({ ...piece, x: 100 + i }));
  scene._debrisEffects();
  const mesh = scene._debris, geometryCount = scene._geometries.length, materialCount = scene._materials.size;
  assert.equal(mesh.count, 120); assert.equal(scene.canvas.dataset.debrisCount, '120');
  const start = matrixOf({ mesh, index: 0 });
  const centre = new T.Vector3().setFromMatrixPosition(start);
  assert.equal(centre.x, 5); assert.equal(centre.y, 2); assert.equal(centre.z, 10);
  scene.game.debris = [{ ...piece, life: .1 }]; scene._debrisEffects();
  assert.equal(mesh.count, 1);
  assert.ok(matrixOf({ mesh, index: 0 }).determinant() < start.determinant() / 20, 'debris shrinks smoothly before removal');
  scene.game.debris = [{ ...piece, x: NaN }, { ...piece, life: 0 }]; scene._debrisEffects();
  assert.equal(mesh.count, 0); assert.equal(mesh.visible, false); assert.equal(scene.canvas.dataset.debrisCount, '0');
  for (let i = 0; i < 60; i++) { scene.game.debris = [piece]; scene._debrisEffects(); }
  assert.equal(scene._debris, mesh);
  assert.equal(scene._geometries.length, geometryCount); assert.equal(scene._materials.size, materialCount);
});
