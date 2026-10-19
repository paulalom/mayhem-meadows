/* Mayhem Meadows: a self-contained, low-poly third-person toy town. */
(function (root) {
  'use strict';
  const UNIT = 20, TAU = Math.PI * 2, DEFAULT_PITCH = -0.24;
  const CHARACTER_SCALE = root.MayhemPhysics?.CHARACTER_SCALE ?? 0.86;
  const MUZZLE_HEIGHT = root.MayhemPhysics?.MUZZLE_HEIGHT ?? 1.15 * CHARACTER_SCALE;
  const FOOT_PIVOT = 1.03 * CHARACTER_SCALE;
  const SIDEWALK_WIDTH = (root.MayhemWorld?.SIDEWALK_WIDTH ?? 32) / UNIT;
  const VehicleStats = root.MayhemVehicleStats || root.MayhemCore?.VehicleStats;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const angle = v => Math.atan2(Math.sin(v), Math.cos(v));
  const mix = (a, b, f) => a + (b - a) * f;
  const palette = ['#ffd15b', '#fb8097', '#67d3c8', '#a6a0fa', '#90c66b', '#6fb5eb'];

  class Scene3D {
    constructor(canvas, game, options = {}) {
      if (!root.THREE) throw new Error('The local 3D renderer could not be loaded.');
      const T = root.THREE;
      this.T = T;
      this.game = game;
      this.canvas = canvas;
      this.reducedMotion = Boolean(options.reducedMotion);
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 1.5));
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      this.renderer.setClearColor('#c4dce5');
      this.scene = new T.Scene();
      this.scene.fog = new T.Fog('#c4dce5', 240, 2200);
      this.camera = new T.PerspectiveCamera(57, 1, 0.06, 3000);
      this.camera.position.set(game.current.x / UNIT, 3.4, game.current.y / UNIT + 5.7);
      this._yaw = -Math.PI / 2;
      this._requestedYaw = this._yaw;
      this._driveOffset = 0;
      this._pitch = DEFAULT_PITCH;
      this._viewPitch = DEFAULT_PITCH;
      this._aiming = false;
      this._aimBlend = 0;
      this._orbitTimer = 0;
      this._cameraMode = 'foot';
      this._lastVehicleId = null;
      this._hasCamera = false;
      this._lastPlayerX = game.player.x;
      this._lastPlayerY = game.player.y;
      this._walkPhase = 0;
      this._cameraTarget = new T.Vector3();
      this._desiredCamera = new T.Vector3();
      this._lookTarget = new T.Vector3();
      this._viewDirection = new T.Vector3();
      this._ray = new T.Raycaster();
      this._pointer = new T.Vector2();
      this._ground = new T.Plane(new T.Vector3(0, 1, 0), 0);
      this._aimPoint = new T.Vector3();
      this._aimBox = new T.Box3();
      this._aimHit = new T.Vector3();
      this._localAimRay = new T.Ray();
      this._dummy = new T.Object3D();
      this._color = new T.Color();
      this._staticParts = new Map();
      this._destructibleParts = new Map();
      this._propRenderStates = new Map();
      this._propInstances = [];
      this._materials = new Map();
      this._geometries = [];
      this._textures = [];
      this._buildingVolumes = [];
      this._buildingFrames = new Map();
      this._propVolumes = [];
      this._propAimMeshes = [];
      this._vehicles = new Map();
      this._aircraft = new Map();
      this._aircraftGeometries = new Map();
      this._residents = new Map();
      this._ragdollRenderedCount = 0;
      this._worldInfo = { characterScale: CHARACTER_SCALE, sidewalkWidth: SIDEWALK_WIDTH, buildings: game.buildings.length, districts: {}, landscape: {} };
      this._cameraInfo = { x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0, mode: 'foot', distance: 0, obstructed: false, viewYaw: this._yaw, viewPitch: this._viewPitch, aiming: false, fov: this.camera.fov };
      this._cube = this._geometry(new T.BoxGeometry(1, 1, 1));
      this._cylinder = this._geometry(new T.CylinderGeometry(1, 1, 1, 12));
      this._sphere = this._geometry(new T.IcosahedronGeometry(1, 1));
      this._cone = this._geometry(new T.ConeGeometry(1, 1, 7));
      this._ringGeometry = this._geometry(new T.TorusGeometry(2.35, 0.085, 6, 48));
      this._lights();
      this._town();
      this._bakeStatics();
      this._freezeStaticWorld();
      this._player = this._person('#7b64df', true);
      this.scene.add(this._player.group);
      this._syncResidents();
      this._makeTarget();
      this._confetti = new T.InstancedMesh(this._cube, this._material('#ffffff', { unlit: true }), 360);
      this._confetti.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this._confetti.frustumCulled = false;
      this._confetti.count = 0;
      this.scene.add(this._confetti);
      this._skids = new T.InstancedMesh(this._cube, this._material('#384d59'), 250);
      this._skids.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this._skids.frustumCulled = false;
      this._skids.count = 0;
      this.scene.add(this._skids);
      this.resize(canvas.clientWidth || 960, canvas.clientHeight || 650);
      this.update(0);
    }

    _geometry(geometry) { this._geometries.push(geometry); return geometry; }

    _material(color, options = {}) {
      const key = color + JSON.stringify(options);
      if (!this._materials.has(key)) {
        const T = this.T;
        const material = options.unlit
          ? new T.MeshBasicMaterial({ color, transparent: Boolean(options.opacity), opacity: options.opacity ?? 1, depthWrite: options.depthWrite ?? true })
          : new T.MeshLambertMaterial({ color, flatShading: true, transparent: Boolean(options.opacity), opacity: options.opacity ?? 1 });
        material.userData.staticPaletteColor = !options.unlit && !options.opacity;
        this._materials.set(key, material);
      }
      return this._materials.get(key);
    }

    _mesh(geometry, material, parent, x, y, z, sx = 1, sy = 1, sz = 1, shadow = true) {
      const mesh = new this.T.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = shadow;
      mesh.receiveShadow = shadow;
      if (parent) parent.add(mesh);
      return mesh;
    }

    _box(parent, color, x, y, z, sx, sy, sz, shadow = true) {
      return this._mesh(this._cube, typeof color === 'string' ? this._material(color) : color, parent, x, y, z, sx, sy, sz, shadow);
    }

    _static(geometry, material, x, y, z, sx, sy, sz, rotation = null, shadow = true) {
      const T = this.T;
      const object = new T.Object3D();
      object.position.set(x, y, z);
      object.scale.set(sx, sy, sz);
      if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2]);
      object.updateMatrix();
      if (this._activePropObject) {
        const key = geometry.uuid + ':' + material.uuid + ':' + shadow;
        this._destructibleParts ??= new Map();
        if (!this._destructibleParts.has(key)) this._destructibleParts.set(key, { geometry, material, shadow, parts: [] });
        this._destructibleParts.get(key).parts.push({ object: this._activePropObject, matrix: object.matrix.clone() });
        return;
      }
      // Opaque town paint shares one shader; keep its exact linear colors in
      // vertex attributes instead of issuing a draw for each paint swatch.
      const colored = material.userData.staticPaletteColor && !material.transparent && material.opacity === 1;
      const key = (colored ? 'static-colors' : material.uuid) + ':' + shadow;
      if (!this._staticParts.has(key)) {
        if (colored && !this._materials.has('static-colors')) this._materials.set('static-colors', new T.MeshLambertMaterial({ color: '#ffffff', flatShading: true, vertexColors: true }));
        this._staticParts.set(key, { material: colored ? this._materials.get('static-colors') : material, shadow, colored, parts: [] });
      }
      this._staticParts.get(key).parts.push({ geometry, matrix: object.matrix.clone(), color: colored ? material.color : null });
    }

    _staticBox(color, x, y, z, sx, sy, sz, shadow = true) {
      this._static(this._cube, typeof color === 'string' ? this._material(color) : color, x, y, z, sx, sy, sz, null, shadow);
    }

    // Compatible opaque paint shares a vertex-colored batch. Transparent and
    // unlit materials, and separate shadow behavior, retain their own batches.
    _bakeStatics() {
      const T = this.T;
      const vector = new T.Vector3(), normal = new T.Vector3(), normalMatrix = new T.Matrix3();
      for (const batch of this._staticParts.values()) {
        let vertices = 0, indices = 0;
        for (const part of batch.parts) { vertices += part.geometry.attributes.position.count; indices += part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count; }
        const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3);
        const colors = batch.colored ? new Float32Array(vertices * 3) : null;
        const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
        let vertexOffset = 0, indexOffset = 0;
        for (const part of batch.parts) {
          const p = part.geometry.attributes.position, n = part.geometry.attributes.normal;
          normalMatrix.getNormalMatrix(part.matrix);
          for (let i = 0; i < p.count; i++) {
            vector.fromBufferAttribute(p, i).applyMatrix4(part.matrix);
            normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
            const at = (vertexOffset + i) * 3;
            positions[at] = vector.x; positions[at + 1] = vector.y; positions[at + 2] = vector.z;
            normals[at] = normal.x; normals[at + 1] = normal.y; normals[at + 2] = normal.z;
            if (colors) { colors[at] = part.color.r; colors[at + 1] = part.color.g; colors[at + 2] = part.color.b; }
          }
          const sourceIndex = part.geometry.index;
          const count = sourceIndex ? sourceIndex.count : p.count;
          for (let i = 0; i < count; i++) index[indexOffset++] = vertexOffset + (sourceIndex ? sourceIndex.getX(i) : i);
          vertexOffset += p.count;
        }
        const geometry = this._geometry(new T.BufferGeometry());
        geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
        if (colors) geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
        geometry.setIndex(new T.BufferAttribute(index, 1));
        geometry.computeBoundingSphere();
        const mesh = new T.Mesh(geometry, batch.material);
        mesh.castShadow = batch.shadow;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
      this._staticParts.clear();
      // Props share a small set of instance batches. Removing a tree, including
      // its canopy, changes only its own slots rather than rebuilding the town.
      this._propInstances ??= [];
      for (const batch of this._destructibleParts?.values() || []) {
        const mesh = new T.InstancedMesh(batch.geometry, batch.material, batch.parts.length);
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        mesh.castShadow = batch.shadow; mesh.receiveShadow = true;
        for (let i = 0; i < batch.parts.length; i++) {
          const part = batch.parts[i];
          mesh.setMatrixAt(i, part.matrix);
          this._propRenderState(part.object).slots.push({ mesh, index: i, matrix: part.matrix });
        }
        this.scene.add(mesh); this._propInstances.push(mesh);
      }
      this._destructibleParts?.clear();
      this._syncDestructibleProps();
    }

    _freezeStaticWorld() {
      // Only the town exists at this point: people, cars, aircraft, trains and
      // mission effects are added afterward. Instance-buffer edits and prop
      // visibility still work; moving lights keep automatic transforms.
      this.scene.updateMatrixWorld(true);
      this.scene.traverse(object => {
        if (object.isLight || object === this._sun.target) return;
        object.matrixAutoUpdate = false;
      });
    }

    _propRenderState(object) {
      this._propRenderStates ??= new Map();
      if (!this._propRenderStates.has(object)) this._propRenderStates.set(object, { slots: [], signs: [], hidden: false });
      return this._propRenderStates.get(object);
    }

    _syncDestructibleProps() {
      const hiddenMatrix = this._hiddenPropMatrix ??= new this.T.Matrix4().makeScale(0, 0, 0);
      for (const [object, state] of this._propRenderStates || []) {
        const hidden = Boolean(object.destroyed);
        if (hidden === state.hidden) continue;
        state.hidden = hidden;
        for (const slot of state.slots) {
          slot.mesh.setMatrixAt(slot.index, hidden ? hiddenMatrix : slot.matrix);
          slot.mesh.instanceMatrix.needsUpdate = true;
        }
        for (const sign of state.signs) sign.visible = !hidden;
      }
      if (this.canvas?.dataset) {
        const objects = this.game.staticObjects || [];
        const destroyed = objects.reduce((count, object) => count + Boolean(object.destroyed), 0);
        this.canvas.dataset.liveProps = String(objects.length - destroyed);
        this.canvas.dataset.destroyedProps = String(destroyed);
      }
    }

    _lights() {
      const T = this.T;
      this.scene.add(new T.HemisphereLight('#f2f5ed', '#8e9c77', 2.0));
      this._sun = new T.DirectionalLight('#fff0d0', 2.1);
      this._sun.position.set(26, 48, -24);
      this._sun.castShadow = true;
      this._sun.shadow.mapSize.set(1024, 1024);
      this._sun.shadow.camera.left = -28;
      this._sun.shadow.camera.right = 28;
      this._sun.shadow.camera.top = 28;
      this._sun.shadow.camera.bottom = -28;
      this._sun.shadow.camera.near = 1;
      this._sun.shadow.camera.far = 100;
      this._sun.shadow.bias = -0.00035;
      this._sun.shadow.normalBias = 0.055;
      this.scene.add(this._sun, this._sun.target);
    }

    _town() {
      const size = root.MayhemCore.SIZE / UNIT;
      this._landscape(size);
      this._roads();
      this._blockGrounds();
      for (let i = 0; i < this.game.buildings.length; i++) this._building(this.game.buildings[i], i);
      this._park();
      this._physicalProps();
      this._services();
      root.MayhemRailwayRender?.render(this);
      root.MayhemMilitaryRender?.render(this);
    }

    _groundY(x, z) {
      return this.game.world?.terrain?.heightAt(x * UNIT, z * UNIT) ?? 0;
    }

    _surfaceY(x, z, reference) {
      return this.game.world?.terrain?.surfaceHeight(x * UNIT, z * UNIT, reference) ?? this._groundY(x, z);
    }

    _surfaceQuaternion(x, z, heading, quaternion) {
      const T = this.T;
      if (!this._surfaceFrame) this._surfaceFrame = { forward: new T.Vector3(), side: new T.Vector3(), up: new T.Vector3(), matrix: new T.Matrix4() };
      const frame = this._surfaceFrame, c = Math.cos(heading), s = Math.sin(heading), half = .4;
      const along = (this._surfaceY(x + c * half, z + s * half) - this._surfaceY(x - c * half, z - s * half)) / (half * 2);
      const across = (this._surfaceY(x - s * half, z + c * half) - this._surfaceY(x + s * half, z - c * half)) / (half * 2);
      frame.forward.set(c, along, s).normalize();
      frame.side.set(-s, across, c).normalize();
      frame.up.crossVectors(frame.side, frame.forward).normalize();
      frame.side.crossVectors(frame.forward, frame.up).normalize();
      frame.matrix.makeBasis(frame.forward, frame.up, frame.side);
      return quaternion.setFromRotationMatrix(frame.matrix);
    }

    _surfaceBox(color, x, z, lift, width, height, depth, heading = 0) {
      if (!this._groundDummy) this._groundDummy = new this.T.Object3D();
      const object = this._groundDummy, material = this._material(color);
      object.position.set(x, this._surfaceY(x, z) + lift, z);
      this._surfaceQuaternion(x, z, heading, object.quaternion);
      object.scale.set(width, height, depth); object.updateMatrix();
      const key = material.uuid + ':false';
      if (!this._staticParts.has(key)) this._staticParts.set(key, { material, shadow: false, parts: [] });
      this._staticParts.get(key).parts.push({ geometry: this._cube, matrix: object.matrix.clone() });
    }

    _surfacePatch(batch, polygon, lift) {
      const field = this.game.world?.terrain;
      const append = points => {
        points = points.filter((point, i) => {
          const previous = points[(i + points.length - 1) % points.length];
          return Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-8;
        });
        if (points.length < 3) return;
        let area = 0;
        for (let i = 0; i < points.length; i++) {
          const a = points[i], b = points[(i + 1) % points.length];
          area += a.x * b.z - b.x * a.z;
        }
        if (Math.abs(area) < .00000001) return;
        // Tight inner sidewalk turns can fold a ribbon quad. Orient each fan
        // triangle independently, and omit slivers that collapse in Float32.
        for (let i = 1; i < points.length - 1; i++) {
          const triangle=[points[0],points[i],points[i+1]].map(p=>({x:Math.fround(p.x),z:Math.fround(p.z)}));
          const [a,b,c]=triangle,turn=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
          if(Math.abs(turn)<1e-9)continue;
          const start=batch.positions.length/3;
          for(const point of triangle)batch.positions.push(point.x,this._surfaceY(point.x,point.z)+lift,point.z);
          if(turn>0)batch.indices.push(start,start+2,start+1);
          else batch.indices.push(start,start+1,start+2);
        }
      };
      if (!field) { append(polygon); return; }
      const step = field.step / UNIT, last = field.count - 2, lastRow=(field.rows||field.count)-2,ox=(field.originX||0)/UNIT,oz=(field.originY||0)/UNIT;
      const minX = Math.max(0, Math.floor((Math.min(...polygon.map(point => point.x))-ox) / step));
      const maxX = Math.min(last, Math.floor((Math.max(...polygon.map(point => point.x))-ox) / step));
      const minZ = Math.max(0, Math.floor((Math.min(...polygon.map(point => point.z))-oz) / step));
      const maxZ = Math.min(lastRow, Math.floor((Math.max(...polygon.map(point => point.z))-oz) / step));
      const clip = (subject, triangle) => {
        let points = subject;
        for (let edge = 0; edge < 3 && points.length; edge++) {
          const a = triangle[edge], b = triangle[(edge + 1) % 3], output = [];
          const distance = point => (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
          let previous = points[points.length - 1], previousDistance = distance(previous);
          for (const point of points) {
            const currentDistance = distance(point), inside = currentDistance >= -1e-8, previousInside = previousDistance >= -1e-8;
            if (inside !== previousInside) {
              const fraction = previousDistance / (previousDistance - currentDistance);
              output.push({ x: mix(previous.x, point.x, fraction), z: mix(previous.z, point.z, fraction) });
            }
            if (inside) output.push(point);
            previous = point; previousDistance = currentDistance;
          }
          points = output;
        }
        return points;
      };
      // Each pavement face stays inside one physical heightmap triangle. Merely
      // projecting the corners of a wide road quad lets grass or the underlying
      // sidewalk intersect its middle on a hill.
      for (let row = minZ; row <= maxZ; row++) {
        for (let col = minX; col <= maxX; col++) {
          const a = { x: ox+col * step, z: oz+row * step }, b = { x: ox+(col + 1) * step, z: oz+row * step };
          const c = { x: ox+col * step, z: oz+(row + 1) * step }, d = { x: ox+(col + 1) * step, z: oz+(row + 1) * step };
          append(clip(polygon, [a, b, c]));
          append(clip(polygon, [d, c, b]));
        }
      }
    }

    _bridges() {
      const T = this.T, underside = [], piers = [], roads = this.game.roads.filter(road => road.bridge || road.railOverpasses?.length);
      const field = this.game.world?.terrain;
      if (!field || !roads.length) return;
      const group = new T.Group();
      group.name = 'Supported bridge decks';
      this._bridgeGroup = group;
      this.scene.add(group);
      for (const road of roads) {
        let distance = 0, nextPier = 7;
        const width = road.width / UNIT + SIDEWALK_WIDTH * 2;
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1], b = road.points[i], dx = (b.x - a.x) / UNIT, dz = (b.y - a.y) / UNIT;
          const ay = a.elevation ?? field.surfaceHeight(a.x, a.y), by = b.elevation ?? field.surfaceHeight(b.x, b.y);
          const length = Math.hypot(dx, dz), x = (a.x + b.x) / UNIT / 2, z = (a.y + b.y) / UNIT / 2;
          const height = (ay + by) / 2, pitch = Math.atan2(by - ay, length), heading = Math.atan2(dz, dx);
          this._dummy.position.set(x, height - .16, z);
          this._dummy.rotation.set(0, -heading, pitch);
          this._dummy.scale.set(Math.hypot(length, by - ay) + .035, .32, width);
          this._dummy.updateMatrix(); underside.push(this._dummy.matrix.clone());
          while (nextPier < distance + length) {
            const fraction = (nextPier - distance) / length, px = mix(a.x, b.x, fraction) / UNIT, pz = mix(a.y, b.y, fraction) / UNIT;
            const top = mix(ay, by, fraction) - .32, bottom = this._groundY(px, pz);
            if (top - bottom > .6 && (!road.railOverpasses?.length || root.MayhemRailway && !root.MayhemRailway.intersectsBox(this.game.world.railway, {x:px*UNIT-10,y:pz*UNIT-10,w:20,h:20},60))) {
              this._dummy.position.set(px, (top + bottom) / 2, pz);
              this._dummy.rotation.set(0, -heading, 0);
              this._dummy.scale.set(.70, top - bottom, Math.max(1, width - .8));
              this._dummy.updateMatrix(); piers.push(this._dummy.matrix.clone());
            }
            nextPier += 8;
          }
          distance += length;
        }
      }
      const instances = (name, matrices, color) => {
        const mesh = new T.InstancedMesh(this._cube, this._material(color), matrices.length);
        mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
        matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.computeBoundingSphere(); group.add(mesh);
        return mesh;
      };
      this._bridgeUndersides = instances('Bridge undersides', underside, '#b0aa96');
      this._bridgePiers = instances('Bridge piers', piers, '#bcb39e');
      this._bridgeAimMeshes = [this._bridgeUndersides, this._bridgePiers];
      if (this._worldInfo) this._worldInfo.bridges = { roads: roads.length, deckSegments: underside.length, piers: piers.length };
    }

    _roads() {
      const T = this.T, group = new T.Group(), roads = this.game.roads || [];
      group.name = 'Organic street network';
      this._roadGroup = group;
      this.scene.add(group);
      const batches = new Map();
      const surface = (name, color) => {
        if (!batches.has(name)) batches.set(name, { color, positions: [], indices: [] });
        return batches.get(name);
      };
      const paving = surface('Continuous sidewalks', '#d5d4c6');
      const asphalt = surface('Curved roads', '#647b87');
      const curbs = surface('Curb edges', '#eee7d3');
      const ribbon = (batch, points, inside, outside, height) => {
        const edges = [];
        for (let i = 0; i < points.length; i++) {
          const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
          const before = points[i].clone().sub(previous).normalize(), after = next.clone().sub(points[i]).normalize();
          if (i === 0) before.copy(after);
          if (i === points.length - 1) after.copy(before);
          const normal = new T.Vector2(-before.y - after.y, before.x + after.x).normalize();
          const divisor = Math.max(0.35, normal.dot(new T.Vector2(-after.y, after.x)));
          edges.push([inside, outside].map(offset => ({ x: points[i].x + normal.x * offset / divisor, z: points[i].y + normal.y * offset / divisor })));
        }
        for (let i = 1; i < edges.length; i++) {
          this._surfacePatch(batch, [edges[i - 1][0], edges[i - 1][1], edges[i][1], edges[i][0]], height);
        }
      };
      const disk = (batch, point, radius, height) => {
        const polygon = [], sides = 24;
        for (let i = 0; i < sides; i++) polygon.push({ x: point.x + Math.cos(i / sides * TAU) * radius, z: point.y + Math.sin(i / sides * TAU) * radius });
        this._surfacePatch(batch, polygon, height);
      };
      const junctions = new Map();
      const incident = (id, point, half) => {
        if (!junctions.has(id)) junctions.set(id, { point, half, roads: 0 });
        const node = junctions.get(id);
        node.half = Math.max(node.half, half);
        node.roads++;
      };
      for (const road of roads) {
        const points = road.points.map(p => new T.Vector2(p.x / UNIT, p.y / UNIT));
        const half = road.width / UNIT / 2;
        if (points.length < 2) continue;
        ribbon(paving, points, -half - SIDEWALK_WIDTH, half + SIDEWALK_WIDTH, 0.032);
        ribbon(asphalt, points, -half, half, 0.043);
        for (const side of [-1, 1]) ribbon(curbs, points, side * (half + 0.04), side * (half + 0.12), 0.051);
        incident(road.a, points[0], half);
        incident(road.b, points[points.length - 1], half);
        let travelled = 0;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i], length = a.distanceTo(b), heading = Math.atan2(b.y - a.y, b.x - a.x);
          for (let at = 2.4 - travelled % 2.4; at < length; at += 2.4) {
            if (i === 1 && at < half + 0.9 || i === points.length - 1 && at > length - half - 0.9) continue;
            const p = a.clone().lerp(b, at / length);
            this._surfaceBox('#f4df9e', p.x, p.y, .059, .85, .01, .07, heading);
          }
          travelled += length;
        }
      }
      for (const [id, junction] of junctions) {
        disk(paving, junction.point, junction.half + SIDEWALK_WIDTH, 0.033);
        disk(asphalt, junction.point, junction.half + 0.13, 0.054);
        if (junction.roads < 3) continue;
        for (const road of roads.filter(r => r.a === id || r.b === id)) {
          if (road.district === 'willow' || road.district === 'orchard') continue;
          const start = road.a === id, points = road.points;
          const a = points[start ? 0 : points.length - 1], b = points[start ? 1 : points.length - 2];
          const heading = Math.atan2(b.y - a.y, b.x - a.x), along = junction.half + 0.7;
          for (let stripe = -2; stripe <= 2; stripe++) {
            const across = stripe * 0.65;
            const x = a.x / UNIT + Math.cos(heading) * along - Math.sin(heading) * across;
            const z = a.y / UNIT + Math.sin(heading) * along + Math.cos(heading) * across;
            this._surfaceBox('#f3efd9', x, z, .066, .65, .012, .36, heading);
          }
        }
      }
      for (const [name, batch] of batches) {
        const geometry = this._geometry(new T.BufferGeometry());
        geometry.setAttribute('position', new T.Float32BufferAttribute(batch.positions, 3));
        geometry.setIndex(batch.indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        // Layered pavement is only centimetres apart. A small depth bias keeps
        // the northern road leg readable from aircraft viewing distances.
        const material=this._material(batch.color,{roadLayer:name});
        material.polygonOffset=true;material.polygonOffsetFactor=-1;
        material.polygonOffsetUnits=name==='Curved roads'?-2:name==='Curb edges'?-3:-1;
        const mesh = new T.Mesh(geometry, material);
        mesh.name = name;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      this._bridges();
      if (this._worldInfo) Object.assign(this._worldInfo, {
        worldSize: root.MayhemCore.SIZE / UNIT, sidewalkWidth: SIDEWALK_WIDTH, roads: roads.length, nodeCount: junctions.size,
        roadGraph: roads.map(r => ({ id: r.id, a: r.a, b: r.b, width: r.width / UNIT, district: r.district, bridge: Boolean(r.bridge), points: r.points.map(p => ({ x: p.x / UNIT, y: this._surfaceY(p.x / UNIT, p.y / UNIT), z: p.y / UNIT })) })),
        curvedRoads: roads.filter(r => {
          const a = r.points[0], b = r.points[r.points.length - 1], length = Math.hypot(b.x - a.x, b.y - a.y);
          return r.points.some(p => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / Math.max(1, length) > 5);
        }).length,
        suburbanHomes: this.game.buildings.filter(b => b.district === 'willow' || b.district === 'orchard').length,
        rotatedBuildings: this.game.buildings.filter(b => Math.abs(b.angle || 0) > 0.01).length
      });
    }

    _blockGrounds() {
      for (const block of this.game.blocks || []) {
        const court = block.courtyard, paved = block.district === 'works' || block.district === 'market';
        if (court) this._groundRect(court, paved ? '#b5ada0' : '#acd29f', 0.025);
        const frontageColor = block.district === 'works' ? '#a8aaa0' : paved ? '#d4c8b3' : '#a1c58b';
        if (block.garden) this._groundRect(block.garden, frontageColor, 0.019);
        if (block.driveway) {
          this._groundRect(block.driveway, block.district === 'works' ? '#9caca9' : '#d7ccba', 0.030);
          if (block.district === 'willow' || block.district === 'orchard') {
            const drive = block.driveway, yaw = drive.angle || 0, cosine = Math.cos(yaw), sine = Math.sin(yaw);
            const cx = (drive.x + drive.w / 2) / UNIT, cz = (drive.y + drive.h / 2) / UNIT;
            for (const side of [-1, 1]) {
              const offset = side * drive.w / UNIT * .27;
              this._surfaceBox('#b6b7a3', cx + cosine * offset, cz + sine * offset, .034, .21, .008, drive.h / UNIT, yaw);
            }
          }
        }
        if (this._worldInfo) this._worldInfo.districts[block.district] = (this._worldInfo.districts[block.district] || 0) + 1;
      }
      for (const bay of this.game.world?.parkingBays || []) {
        if (bay.access) this._groundRect(bay.access, '#d7ccba', 0.022);
        this._groundRect(bay, '#9caca9', 0.028);
        const yaw = bay.angle || 0, c = Math.cos(yaw), s = Math.sin(yaw);
        const cx = (bay.x + bay.w / 2) / UNIT, cz = (bay.y + bay.h / 2) / UNIT;
        for (const side of [-1, 1]) {
          const offset = side * (bay.h / 2 - 2) / UNIT;
          this._surfaceBox('#f3efd9', cx - s * offset, cz + c * offset, .039, bay.w / UNIT - .12, .008, .05, yaw);
        }
      }
      for (const garage of (this.game.staticObjects || []).filter(object => object.serviceId === 'repair')) {
        this._groundRect(garage.driveway, '#a8b4ae', .038);
        this._groundRect(garage.lot, '#8f9f9c', .04);
        const c = Math.cos(garage.angle), s = Math.sin(garage.angle), x = garage.x / UNIT, z = garage.y / UNIT;
        const mark = (lx, lz, width, depth, color = '#f4d982', angle = 0) =>
          this._surfaceBox(color, x + c * lx - s * lz, z + s * lx + c * lz, .055, width, .012, depth, garage.angle + angle);
        for (const side of [-1, 1]) mark(side * 2.1, -.1, .1, 6.8);
        mark(0, 3.3, 4.3, .12);
        for (let i = -5; i <= 5; i++) mark(i * .48, -6.15, .25, .45, i % 2 ? '#53636a' : '#f4d982');
        // A painted arrow leads from the apron into the unobstructed bay.
        mark(0, -8.3, .18, 1.1);
        mark(-.24, -7.9, .65, .14, '#f4d982', Math.PI / 4); mark(.24, -7.9, .65, .14, '#f4d982', -Math.PI / 4);
      }
      if (this._worldInfo) this._worldInfo.parkingBays = this.game.world?.parkingBays?.length || 0;
    }

    _groundRect(rect, color, height) {
      const T = this.T, width = rect.w / UNIT, depth = rect.h / UNIT, yaw = rect.angle || 0;
      const cx = (rect.x + rect.w / 2) / UNIT, cz = (rect.y + rect.h / 2) / UNIT, c = Math.cos(yaw), s = Math.sin(yaw);
      const batch = { positions: [], indices: [] };
      const polygon = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([px, pz]) => ({ x: cx + px * width * c - pz * depth * s, z: cz + px * width * s + pz * depth * c }));
      this._surfacePatch(batch, polygon, height);
      const geometry = this._geometry(new T.BufferGeometry());
      geometry.setAttribute('position', new T.Float32BufferAttribute(batch.positions, 3));
      geometry.setIndex(batch.indices); geometry.computeVertexNormals();
      this._static(geometry, this._material(color), 0, 0, 0, 1, 1, 1, null, false);
    }

    _roofGeometry() {
      if (!this._gableRoof) {
        const geometry = new this.T.BufferGeometry();
        geometry.setAttribute('position', new this.T.Float32BufferAttribute([
          -.5,0,-.5, -.5,0,.5, 0,1,-.5, 0,1,-.5, -.5,0,.5, 0,1,.5,
          0,1,-.5, 0,1,.5, .5,0,-.5, .5,0,-.5, 0,1,.5, .5,0,.5,
          -.5,0,-.5, 0,1,-.5, .5,0,-.5, -.5,0,.5, .5,0,.5, 0,1,.5
        ], 3));
        geometry.computeVertexNormals(); this._gableRoof = this._geometry(geometry);
      }
      return this._gableRoof;
    }

    _building(building, index) {
      const x = building.x / UNIT, z = building.y / UNIT, w = building.w / UNIT, d = building.h / UNIT;
      const height = building.height || 5.3, style = building.style || 'shop';
      const cx = x + w / 2, cz = z + d / 2, cottage = style === 'cottage';
      const base = building.elevation ?? this._groundY(cx, cz);
      const bottom = building.foundationBottom ?? base;
      const wallHeight = cottage ? Math.max(1.8, height - 1.0) : height - 0.18;
      const roofColor = cottage ? ['#8c746c', '#6a8583', '#ad7e72'][index % 3] : '#778b91';
      const rotation = building.angle || 0, cosine = Math.cos(rotation), sine = Math.sin(rotation);
      const point = (px, pz) => ({ x: cx + (px - cx) * cosine - (pz - cz) * sine, z: cz + (px - cx) * sine + (pz - cz) * cosine });
      const box = (color, px, py, pz, sx, sy, sz, shadow = true) => {
        const p = point(px, pz);
        this._static(this._cube, typeof color === 'string' ? this._material(color) : color, p.x, base + py, p.z, sx, sy, sz, [0, -rotation, 0], shadow);
      };
      const sign = (text, px, py, pz, width, signHeight) => {
        const p = point(px, pz);
        this._sign(text, p.x, base + py, p.z, -rotation, '#fff4d6', '#425963', width, signHeight);
      };
      const halfX = w / 2 + .12, halfZ = d / 2 + .12;
      const extentX = Math.abs(cosine) * halfX + Math.abs(sine) * halfZ, extentZ = Math.abs(sine) * halfX + Math.abs(cosine) * halfZ;
      this._buildingVolumes.push({
        id: building.id, cx, cz, halfX, halfZ, physicalHalfX: w / 2, physicalHalfZ: d / 2, baseElevation: base, foundationBottom: bottom, height, angle: rotation, cosine, sine,
        minX: cx - extentX, maxX: cx + extentX, minZ: cz - extentZ, maxZ: cz + extentZ, minY: bottom - .2, maxY: base + height + .45
      });
      if (this._buildingFrames) this._buildingFrames.set(building.id ?? index, {
        center: { x: cx, y: base + height / 2, z: cz }, baseElevation: base, foundationBottom: bottom, yaw: -rotation, front: point(cx, z + d), width: w, depth: d, height, style
      });
      if(building.militaryModel&&root.MayhemMilitaryRender)return;
      if (base > bottom + .001) box('#c5bfad', cx, -(base - bottom) / 2, cz, w, base - bottom, d);
      box(building.color, cx, wallHeight / 2, cz, w, wallHeight, d);
      box('#f1ead8', cx, 0.18, cz, w + .08, .36, d + .08);
      if (cottage) this._static(this._roofGeometry(), this._material(roofColor), cx, base + wallHeight, cz, w + .22, height - wallHeight, d + .22, [0, -rotation, 0]);
      else {
        box('#ddd9cc', cx, height - .09, cz, w + .15, .20, d + .15);
        box(roofColor, cx, height + .025, cz, Math.max(.2, w - .18), .045, Math.max(.2, d - .18));
      }
      const warehouse = style === 'warehouse' || style === 'hangar', floors = cottage ? 1 : Math.max(1, Math.floor((wallHeight - .5) / (warehouse ? 2.2 : 1.8)));
      const alongX = Math.max(1, Math.floor(w / 1.6)), alongZ = Math.max(1, Math.floor(d / 1.6));
      for (let floor = 0; floor < floors; floor++) {
        const y = cottage ? 1.35 : 1.25 + floor * (warehouse ? 2.2 : 1.8);
        for (const side of [-1, 1]) {
          for (let column = 0; column < alongX; column++) {
            const px = x + (column + .5) * w / alongX;
            box('#f3eddc', px, y, cz + side * (d / 2 + .02), Math.min(.9, w / alongX * .65), .88, .05, false);
            box(warehouse ? '#708a91' : '#7396a3', px, y, cz + side * (d / 2 + .055), Math.min(.72, w / alongX * .5), .69, .025, false);
          }
          for (let column = 0; column < alongZ; column++) {
            const pz = z + (column + .5) * d / alongZ;
            box('#f3eddc', cx + side * (w / 2 + .02), y, pz, .05, .88, Math.min(.9, d / alongZ * .65), false);
            box(warehouse ? '#708a91' : '#7396a3', cx + side * (w / 2 + .055), y, pz, .025, .69, Math.min(.72, d / alongZ * .5), false);
          }
        }
      }
      if (warehouse) {
        for (let y = .5; y < wallHeight; y += .42) box('#aa8475', cx, y, z + d + .022, w - .12, .018, .022, false);
        box('#607481', cx, 1.1, z + d + .035, Math.min(2.6, w * .5), 2.0, .05, false);
        for (let y = .3; y < 2.1; y += .2) box('#8d9fa4', cx, y, z + d + .07, Math.min(2.5, w * .48), .025, .025, false);
      } else box('#426674', cx, .8, z + d + .04, Math.min(.75, w * .2), 1.5, .04, false);
      if (cottage) {
        box('#ddcfb1', cx, .065, z + d + .4, Math.min(1.6, w * .6), .065, .8, false);
        box('#f1dbb1', cx, 1.9, z + d + .14, Math.min(1.6, w * .6), .1, .32);
      } else {
        const frontage = Math.min(3.2, w * .86), awning = style === 'cafe' ? '#7ba89d' : '#e89988';
        box(awning, cx, 2.05, z + d + .32, frontage, .13, .65);
        for (let i = 0; i < 6; i++) box('#faedcf', cx - frontage / 2 + (i + .5) * frontage / 6, 2.125, z + d + .33, frontage / 12, .015, .67, false);
        sign(building.name, cx, Math.min(wallHeight - .35, 2.72), z + d + .11, Math.min(3.5, w * .88), .55);
      }
      if (style === 'tower') {
        sign('12 : 00', cx, height - 1.15, z + d + .13, Math.min(2.5, w * .8), .8);
        box('#d6b276', cx, height + .18, cz, .12, .35, .12);
      }
      if (style === 'control-tower') {
        for (const side of [-1, 1]) {
          box('#76a6b3', cx, height - 1.35, cz + side * (d / 2 + .03), w * .94, 1.15, .06, false);
          box('#76a6b3', cx + side * (w / 2 + .03), height - 1.35, cz, .06, 1.15, d * .94, false);
        }
        sign('MEADOWS AIR', cx, 2.72, z + d + .11, Math.min(3.5, w * .88), .55);
      }
    }

    _landscape(size) {
      const T = this.T, field = this.game.world?.terrain;
      const landscape = new T.Group(), water = new T.Group();
      landscape.name = 'Playable terrain';
      water.name = 'Ocean and river';
      this._landscapeGroup = landscape;
      this._riverGroup = water;
      this.scene.add(landscape, water);
      if (!field) return;
      const count = field.count, rows=field.rows||count,step = field.step / UNIT, total = count * rows,ox=(field.originX||0)/UNIT,oz=(field.originY||0)/UNIT;
      const positions = new Float32Array(total * 3), colors = new Float32Array(total * 3);
      const indices = new Uint32Array((count - 1)*(rows-1) * 6);
      const sand = new T.Color('#dacda3'), grass = new T.Color('#a5c58c'), forest = new T.Color('#78a382'), rock = new T.Color('#a6aba2');
      let low = Infinity, high = -Infinity, at = 0;
      for (let row = 0; row < rows; row++) for (let col = 0; col < count; col++) {
        const index = row * count + col, height = field.heights[index];
        positions.set([ox+col * step, height, oz+row * step], index * 3);
        low = Math.min(low, height); high = Math.max(high, height);
        const dx = (field.heights[row * count + Math.min(count - 1, col + 1)] - field.heights[row * count + Math.max(0, col - 1)]) / (step * 2);
        const dz = (field.heights[Math.min(rows - 1, row + 1) * count + col] - field.heights[Math.max(0, row - 1) * count + col]) / (step * 2);
        const color = grass.clone();
        if (height < 2.2) color.lerp(sand, clamp((2.2 - height) / 2.2, 0, 1));
        else color.lerp(forest, clamp((height - 6) / 30, 0, .7));
        color.lerp(rock, clamp((Math.hypot(dx, dz) - .32) * 1.5, 0, .9));
        colors.set([color.r, color.g, color.b], index * 3);
        if (row < rows - 1 && col < count - 1) {
          // Cannon's anti-diagonal splits each cell across highX/lowY and
          // lowX/highY. The visible triangles use exactly those vertices.
          indices.set([index, index + count, index + 1, index + count + 1, index + 1, index + count], at);
          at += 6;
        }
      }
      const geometry = this._geometry(new T.BufferGeometry());
      geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
      geometry.setIndex(new T.BufferAttribute(indices, 1));
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const material = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      this._materials.set('terrain', material);
      this._terrainMesh = new T.Mesh(geometry, material);
      this._terrainMesh.name = 'Shared heightmap';
      this._terrainMesh.receiveShadow = true;
      landscape.add(this._terrainMesh);
      const waterLevel = field.waterLevel ?? 0;
      const airspace=this.game.world?.landscape?.airspace;
      const waterWidth=airspace ? (airspace.maxX-airspace.minX)/UNIT+2000 : size+240;
      const waterDepth=airspace ? (airspace.maxY-airspace.minY)/UNIT+2000 : size+240;
      const waterGeometry = this._geometry(new T.PlaneGeometry(waterWidth,waterDepth));
      this._riverSurface = new T.Mesh(waterGeometry, this._material('#7eb9c7'));
      this._riverSurface.name = 'Coastal water';
      this._riverSurface.rotation.x = -Math.PI / 2;
      this._riverSurface.position.set(airspace?(airspace.minX+airspace.maxX)/UNIT/2:size/2,waterLevel,airspace?(airspace.minY+airspace.maxY)/UNIT/2:size/2);
      water.add(this._riverSurface);
      // Only glints are animated; the large sea and river remain one surface.
      // Each glint starts on a water cell, including the southern ocean.
      this._waterGlints = [];
      for (let row = 2; row < rows - 2; row += 7) for (let col = 2; col < count - 2; col += 7) {
        const x = ox+(col + Math.sin(row * 2) * .8) * step, z = oz+(row + Math.cos(col * 3) * .8) * step;
        if (field.isWater(x * UNIT, z * UNIT)) this._waterGlints.push({ x, z, phase: col * .67 + row });
      }
      this._riverFlow = new T.InstancedMesh(this._cube, this._material('#b8dde0', { unlit: true }), this._waterGlints.length);
      this._riverFlow.name = 'Water glints';
      water.add(this._riverFlow);
      const bridges = this.game.roads.filter(road => road.bridge);
      this._worldInfo.landscape = {
        terrainVertices: total, terrainTriangles: indices.length / 3, minElevation: low, maxElevation: high,
        terrainStep: step, waterLevel, waterGlints: this._waterGlints.length, bridgeCount: bridges.length,
        mapWidth: (this.game.world.mapWidth || root.MayhemCore.SIZE) / UNIT,
        mapHeight: (this.game.world.mapHeight || root.MayhemCore.SIZE) / UNIT
      };
      this._landscapeStep(0);
    }

    _landscapeStep(time) {
      if (!this._riverFlow) return;
      const field = this.game.world.terrain, waterLevel = field.waterLevel ?? 0;
      for (let i = 0; i < this._waterGlints.length; i++) {
        const point = this._waterGlints[i], phase = this.reducedMotion ? 0 : Math.sin(time * .35 + point.phase) * .45;
        const x = point.x + phase, z = point.z;
        const visible = field.isWater(x * UNIT, z * UNIT);
        this._dummy.position.set(x, waterLevel + .012, z);
        this._dummy.rotation.set(0, -.2, 0);
        this._dummy.scale.set(visible ? .6 + (i % 3) * .12 : 0, .008, .035);
        this._dummy.updateMatrix();
        this._riverFlow.setMatrixAt(i, this._dummy.matrix);
      }
      this._riverFlow.instanceMatrix.needsUpdate = true;
    }

    _sign(text, x, y, z, yaw, background = '#fff9df', ink = '#385160', width = 3, height = 0.8) {
      const T = this.T, canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 128);
      ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 44px system-ui, sans-serif';
      const fit = Math.min(1, 475 / ctx.measureText(text).width);
      ctx.font = '800 ' + Math.floor(44 * fit) + 'px system-ui, sans-serif';
      ctx.fillText(text, 256, 65);
      const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
      this._textures.push(texture);
      const material = new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide });
      this._materials.set('sign-' + this._textures.length, material);
      const geometry = this._geometry(new T.PlaneGeometry(width, height));
      const sign = new T.Mesh(geometry, material);
      sign.position.set(x, y, z); sign.rotation.y = yaw;
      this.scene.add(sign);
      if (this._activePropObject) this._propRenderState(this._activePropObject).signs.push(sign);
      return sign;
    }

    _tree(x, z, scale = 1, variety = 0, includeTrunk = true, elevation = 0) {
      if (includeTrunk) this._static(this._cylinder, this._material('#a88462'), x, elevation + 0.7 * scale, z, 0.14 * scale, 1.4 * scale, 0.14 * scale);
      if (variety % 3 === 0) {
        this._static(this._cone, this._material('#63ac85'), x, elevation + 1.95 * scale, z, 0.95 * scale, 2.5 * scale, 0.95 * scale);
        this._static(this._cone, this._material('#80bf8e'), x, elevation + 2.75 * scale, z, 0.65 * scale, 1.8 * scale, 0.65 * scale);
      } else {
        this._static(this._sphere, this._material(variety % 2 ? '#88be83' : '#67af91'), x, elevation + 2.0 * scale, z, 1.0 * scale, 1.22 * scale, 1.0 * scale);
        this._static(this._sphere, this._material('#a5cb82'), x - 0.35 * scale, elevation + 2.5 * scale, z + 0.2 * scale, 0.65 * scale, 0.65 * scale, 0.65 * scale);
      }
    }

    _lamp(x, z) {
      this._static(this._cylinder, this._material('#536d74'), x, 1.9, z, 0.075, 3.8, 0.075);
      this._staticBox('#536d74', x - 0.4, 3.65, z, 0.9, 0.12, 0.1);
      this._staticBox('#fcf1be', x - 0.82, 3.59, z, 0.5, 0.14, 0.36, false);
    }

    _park() {
      const layout = this.game.world?.landscape || this.game.landscape || {};
      for (const meadow of layout.meadow || []) this._groundRect(meadow, '#adc893', .011);
      for (const green of layout.greens || []) {
        const x = (green.x + green.w / 2) / UNIT, z = (green.y + green.h / 2) / UNIT;
        this._groundRect(green, '#95be8b', .019);
        this._groundRect({ x: x * UNIT - 11, y: green.y, w: 22, h: green.h }, '#e4d7b2', .036);
        this._groundRect({ x: green.x, y: z * UNIT - 11, w: green.w, h: 22 }, '#e4d7b2', .038);
        const district = root.MayhemWorld?.DISTRICTS[green.district];
        const signZ = z - green.h / UNIT / 2 + .2;
        this._sign(district?.name || 'VILLAGE GREEN', x, this._surfaceY(x, signZ) + 1.05, signZ, 0, '#f3e5ad', '#40785f', 2.4, .48);
        for (let i = 0; i < 8; i++) {
          const px = x - 2.1 + i * .6, pz = z + green.h / UNIT / 2 - .7;
          this._static(this._sphere, this._material(palette[i % palette.length]), px, this._surfaceY(px, pz) + .12, pz, .12, .12, .12, null, false);
        }
      }
      const airport = layout.airport;
      if (airport) {
        for (const apron of airport.aprons || []) this._groundRect(apron, '#bec5b6', .019);
        for (const taxiway of airport.taxiways || []) {
          this._groundRect(taxiway, '#81939b', .023);
          const cx = (taxiway.x + taxiway.w / 2) / UNIT, cz = (taxiway.y + taxiway.h / 2) / UNIT;
          this._surfaceBox('#edcd65', cx, cz, .05, taxiway.w > taxiway.h ? taxiway.w / UNIT : .10, .008,
            taxiway.h >= taxiway.w ? taxiway.h / UNIT : .10, taxiway.angle || 0);
        }
        for (const runway of airport.runways || []) {
          this._groundRect(runway, '#6c7f88', .025);
          const width = runway.w / UNIT, length = runway.h / UNIT, yaw = runway.angle || 0;
          const cx = (runway.x + runway.w / 2) / UNIT, cz = (runway.y + runway.h / 2) / UNIT, c = Math.cos(yaw), s = Math.sin(yaw);
          for (let along = -length / 2 + 6; along < length / 2 - 5; along += 4) {
            this._surfaceBox('#f4efd9', cx - s * along, cz + c * along, .044, 1.8, .008, .12, yaw + Math.PI / 2);
          }
          for (const end of [-1, 1]) for (let stripe = -2; stripe <= 2; stripe++) {
            const across = stripe * width / 7, along = end * (length / 2 - 2);
            this._surfaceBox('#f4efd9', cx + c * across - s * along, cz + s * across + c * along, .044, 2.4, .008, .18, yaw + Math.PI / 2);
          }
        }
        for (const pad of airport.helipads || []) this._aviationPad(pad);
        for (const stand of (airport.stands || []).concat(airport.militaryStands || [])) {
          const x = stand.x / UNIT, z = stand.y / UNIT, elevation = stand.elevation ?? this._surfaceY(x, z);
          if (stand.type === 'transportheli' || stand.aircraftType === 'transportheli') this._aviationPad(stand);
          for (const side of [-1, 1]) this._static(this._cube, this._material('#efd57b'), x, elevation + .07, z + side * 3,
            4.3, .012, .10, [0, -(stand.angle || 0), 0], false);
          this._sign(stand.label || 'AIRCRAFT STAND', x - 3, elevation + .9, z - 3.3, -(stand.angle || 0), '#f1d776', '#3d555f', 2.3, .4);
        }
        if (this._worldInfo) this._worldInfo.airport = { runways: airport.runways?.length || 0, taxiways: airport.taxiways?.length || 0, aprons: airport.aprons?.length || 0,
          helipads: airport.helipads?.length || 0, stands: (airport.stands?.length || 0) + (airport.militaryStands?.length || 0) };
      }
      for (const pad of layout.helipads || []) this._aviationPad(pad);
    }

    _aviationPad(pad) {
      const x = pad.x / UNIT, z = pad.y / UNIT, radius = (pad.radius || 100) / UNIT;
      const elevation = pad.elevation ?? this._surfaceY(x, z), yaw = -(pad.angle || 0);
      this._static(this._cylinder, this._material(pad.rooftop ? '#546b76' : '#7c9393'), x, elevation + .035, z, radius, .04, radius, null, false);
      this._helipadRing ??= this._geometry(new this.T.TorusGeometry(1, .016, 4, 48));
      this._static(this._helipadRing, this._material('#f4edc9'), x, elevation + .068, z, radius * .82, radius * .82, radius * .82, [-Math.PI / 2, 0, 0], false);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const side of [-1, 1]) this._static(this._cube, this._material('#f4edc9'), x + c * side * radius * .25, elevation + .071, z - s * side * radius * .25,
        radius * .11, .012, radius, [0, yaw, 0], false);
      this._static(this._cube, this._material('#f4edc9'), x, elevation + .071, z, radius * .60, .012, radius * .11, [0, yaw, 0], false);
      this._sign(pad.label || 'HELIPAD', x, elevation + 1, z - radius - .2, 0, '#e6deb6', '#415f67', 2.6, .42);
    }

    _physicalProps() {
      // The town map owns both physical shapes and their visual placement.
      // Decoration can change without introducing a second obstacle layout.
      const colors = {
        tree: ['#a88462', '#67af91'], lamp: ['#536d74', '#536d74', '#fcf1be'],
        bench: ['#cf9771'], fountain: ['#eee7d3', '#f3eddc', '#f3eddc'],
        garage: ['#b8a1e0', '#ffe0b1'], planter: ['#b08d77'],
        bollard: ['#5c7781'], wayfinding: ['#687d74', '#f1ddae'], fence: ['#e7ddbd'], hedge: ['#78a578']
      };
      for (const object of this.game.staticObjects || []) {
        const customVisuals=object.militaryRendered&&root.MayhemMilitaryRender;
        this._activePropObject = object.kind !== 'garage' && object.destructible !== false ? object : null;
        if (this._activePropObject) this._propRenderState(object);
        const x = object.x / UNIT, z = object.y / UNIT, elevation = object.elevation ?? this._surfaceY(x, z);
        const yaw = -(object.angle || 0), cosine = Math.cos(yaw), sine = Math.sin(yaw);
        const sign = (text, offset, height, facing, background, ink, width, signHeight) => {
          this._sign(text, x + sine * offset, elevation + height, z + cosine * offset, yaw + facing, background, ink, width, signHeight);
        };
        for (let i = 0; i < (object.parts || []).length; i++) {
          const part = object.parts[i], offset = part.offset || [0, object.height / 2, 0];
          const half = part.half || [object.width / UNIT / 2, object.height / 2, object.depth / UNIT / 2];
          const px = x + cosine * offset[0] + sine * offset[2], py = elevation + offset[1], pz = z - sine * offset[0] + cosine * offset[2];
          const choices = colors[object.kind] || ['#b8a1e0'];
          const color = part.color || choices[Math.min(i, choices.length - 1)];
          const shape = part.shape || 'box';
          const geometry = shape === 'cylinder' ? this._cylinder : shape === 'sphere' ? this._sphere : this._cube;
          const sx = shape === 'cylinder' || shape === 'sphere' ? half[0] : half[0] * 2;
          const sy = shape === 'sphere' ? half[1] : half[1] * 2;
          const sz = shape === 'cylinder' || shape === 'sphere' ? half[2] : half[2] * 2;
          const material = this._material(color);
          if(!customVisuals)this._static(geometry, material, px, py, pz, sx, sy, sz, [0, yaw, 0]);
          if (geometry && this._propAimMeshes) {
            // Raycast the exact shared shape without adding another draw call;
            // its visible twin is baked into the static material batches.
            const aimMesh = new this.T.Mesh(geometry, material);
            aimMesh.position.set(px, py, pz); aimMesh.scale.set(sx, sy, sz); aimMesh.rotation.y = yaw;
            aimMesh.propObject = object;
            aimMesh.updateMatrixWorld(true); this._propAimMeshes.push(aimMesh);
          }
          const extentX = Math.abs(cosine) * half[0] + Math.abs(sine) * half[2];
          const extentZ = Math.abs(sine) * half[0] + Math.abs(cosine) * half[2];
          this._propVolumes.push({ object, minX: px - extentX, maxX: px + extentX, minY: py - half[1], maxY: py + half[1], minZ: pz - extentZ, maxZ: pz + extentZ });
          if (object.serviceId === 'repair') this._buildingVolumes.push({
            object, cx: px, cz: pz, halfX: half[0], halfZ: half[2], cosine, sine: -sine,
            minY: py - half[1], maxY: py + half[1]
          });
        }
        if (object.kind === 'tree') this._tree(x, z, object.scale || 1.05, object.variety || 0, false, elevation);
        if (object.kind === 'fountain') {
          this._static(this._cylinder, this._material('#7dd9e6'), x, elevation + 0.63, z, 1.43, 0.07, 1.43, null, false);
          this._static(this._sphere, this._material('#a3e5eb'), x, elevation + 1.70, z, 0.18, 0.55, 0.18, null, false);
        }
        if (object.serviceId === 'repair') {
          sign('COOL-DOWN GARAGE', -6.03, 4.5, Math.PI, '#fff1c8', '#385e65', 7.8, .68);
          sign('REPAIRS $75  /  STOP + PRESS E', 5.57, 2.9, Math.PI, '#dcfff1', '#385e65', 6.2, .62);
          sign('DRIVE IN', -6.05, 3.85, Math.PI, '#385e65', '#fff1c8', 3.2, .38);
          // Ceiling strips, a worktop and drawer fronts make the open interior
          // readable without filling the actual driveable space with props.
          const detail = (color, lx, ly, lz, w, h, d) => this._static(this._cube, this._material(color),
            x + cosine * lx + sine * lz, elevation + ly, z - sine * lx + cosine * lz, w, h, d, [0, yaw, 0]);
          for (const side of [-1, 1]) detail('#fff0c1', side * 2.8, 4.94, 0, .22, .05, 6.5);
          detail('#dfceb0', 0, 1.04, 5, 4.9, .08, 1.1);
          for (let i = 0; i < 4; i++) detail('#cbd3c9', i * 1.15 - 1.72, .55, 4.48, 1, .62, .03);
          for (let i = 0; i < 3; i++) detail('#f1d7ad', 3.9, .4 + i * .55, 4.28, .85, .035, .03);
        } else if (object.kind === 'garage') sign('SPRINKLE GARAGE', -.68, 1.26, 0, '#fff1c8', '#775688', 1.75, .5);
        if (object.kind === 'wayfinding') sign(object.label, -.045, 1.3, Math.PI, '#f1ddae', '#425e5c', .94, .37);
        if (object.kind === 'planter') {
          this._static(this._sphere, this._material('#7da676'), x, elevation + 0.62, z, 0.48, 0.23, 0.26);
          for (const side of [-1, 1]) this._static(this._sphere, this._material('#e8b393'), x + side * 0.27, elevation + 0.76, z, 0.08, 0.09, 0.08, null, false);
        }
      }
      this._activePropObject = null;
    }

    _services() {
      for (const service of this.game.services) this._serviceRing(service.x / UNIT, service.y / UNIT, service.id === 'garage' ? '#c9a5ff' : '#78eee2');
    }

    _serviceRing(x, z, color) {
      const ring = this._mesh(this._ringGeometry, this._material(color, { unlit: true }), this.scene, x, this._surfaceY(x, z) + .065, z, .88, .88, .88, false);
      this._surfaceQuaternion(x, z, 0, ring.quaternion);
      ring.rotateX(-Math.PI / 2);
    }

    _handToys(arm) {
      const T = this.T, toys = {};
      for (const id of ['popper', 'hammer', 'cannon']) {
        const toy = new T.Group();
        toy.name = 'toy-' + id;
        arm.add(toy); toys[id] = toy;
        toy.visible = id === 'popper';
      }
      // Their barrels point down the resting arm and forward when it is raised.
      this._mesh(this._cylinder, this._material('#efd579'), toys.popper, 0, -0.55, 0, 0.085, 0.40, 0.085);
      this._mesh(this._cylinder, this._material('#ee839d'), toys.popper, 0, -0.70, 0, 0.092, 0.08, 0.092);
      this._mesh(this._cylinder, this._material('#7c65dd'), toys.popper, 0, -0.40, 0, 0.092, 0.065, 0.092);
      this._box(toys.hammer, '#ffe2a3', 0, -0.60, 0, 0.10, 0.63, 0.10);
      this._box(toys.hammer, '#ff98bc', 0, -0.98, 0, 0.42, 0.34, 0.83);
      this._box(toys.hammer, '#fff0d5', 0, -0.98, -0.36, 0.45, 0.37, 0.11);
      this._box(toys.hammer, '#fff0d5', 0, -0.98, 0.36, 0.45, 0.37, 0.11);
      this._box(toys.hammer, '#df719d', 0.217, -0.98, 0, 0.016, 0.14, 0.22, false);
      this._mesh(this._cylinder, this._material('#a6a0fa'), toys.cannon, 0, -0.56, 0, 0.23, 0.57, 0.23);
      this._mesh(this._cylinder, this._material('#ffd15b'), toys.cannon, 0, -0.86, 0, 0.26, 0.16, 0.26);
      this._mesh(this._cylinder, this._material('#425a73'), toys.cannon, 0, -0.948, 0, 0.20, 0.018, 0.20, false);
      this._box(toys.cannon, '#67d3c8', 0.21, -0.38, 0, 0.22, 0.15, 0.20);
      this._box(toys.cannon, '#fb8097', -0.23, -0.48, 0, 0.08, 0.25, 0.18);
      for (const toy of Object.values(toys)) this._mergeColored(toy);
      return toys;
    }

    _person(color, player) {
      const T = this.T, group = new T.Group();
      const skin = this._material(player ? '#f9c68f' : '#edbd93');
      const shirt = this._material(color), pants = this._material(player ? '#355267' : '#647386');
      const leftLeg = new T.Group(), rightLeg = new T.Group();
      leftLeg.position.set(0, 0.62, -0.13); rightLeg.position.set(0, 0.62, 0.13);
      group.add(leftLeg, rightLeg);
      this._box(leftLeg, pants, 0, -0.25, 0, 0.19, 0.50, 0.18);
      this._box(rightLeg, pants, 0, -0.25, 0, 0.19, 0.50, 0.18);
      this._box(leftLeg, '#f2efdf', 0.075, -0.51, 0, 0.33, 0.14, 0.22);
      this._box(rightLeg, '#f2efdf', 0.075, -0.51, 0, 0.33, 0.14, 0.22);
      const torso = this._box(group, shirt, 0, 0.94, 0, 0.36, 0.62, 0.48);
      const leftArm = new T.Group(), rightArm = new T.Group();
      leftArm.position.set(0, 1.17, -0.34); rightArm.position.set(0, 1.17, 0.34);
      group.add(leftArm, rightArm);
      this._box(leftArm, shirt, 0, -0.10, 0, 0.19, 0.30, 0.18);
      this._box(rightArm, shirt, 0, -0.10, 0, 0.19, 0.30, 0.18);
      this._box(leftArm, skin, 0, -0.32, 0, 0.15, 0.19, 0.16);
      this._box(rightArm, skin, 0, -0.32, 0, 0.15, 0.19, 0.16);
      this._mesh(this._sphere, skin, group, 0.015, 1.48, 0, 0.235, 0.26, 0.23);
      this._box(group, player ? '#f1cf5d' : '#6f5b55', -0.02, 1.66, 0, 0.37, 0.10, 0.42);
      this._box(group, player ? '#f1cf5d' : '#6f5b55', 0.18, 1.64, 0, 0.30, 0.055, 0.38);
      this._box(group, '#384657', 0.22, 1.49, -0.08, 0.035, 0.055, 0.045, false);
      this._box(group, '#384657', 0.22, 1.49, 0.08, 0.035, 0.055, 0.045, false);
      let toys = null;
      if (player) {
        this._box(group, '#e48b83', -0.25, 0.99, 0, 0.22, 0.43, 0.36);
        this._box(group, '#f4d180', -0.375, 0.99, 0, 0.035, 0.25, 0.23);
        toys = this._handToys(rightArm);
        this._box(group, '#fff1bd', -0.18, 1.22, -0.22, 0.04, 0.35, 0.04, false);
        this._box(group, '#fff1bd', -0.18, 1.22, 0.22, 0.04, 0.35, 0.04, false);
      }
      for (const limb of [leftLeg, rightLeg, leftArm, rightArm]) this._mergeColored(limb);
      this._mergeColored(group);
      group.scale.setScalar(CHARACTER_SCALE);
      return { group, leftLeg, rightLeg, leftArm, rightArm, torso, toys, equipped: player ? 'popper' : null, phase: 0, color, player };
    }

    _vehicle(entity, police) {
      if(entity.kind==='truck'&&root.MayhemTroopRender){
        const model=root.MayhemTroopRender.createVehicle(this,entity);if(model)return model;
      }
      if(entity.kind==='tank'&&root.MayhemTankRender){
        const model=root.MayhemTankRender.createVehicle(this,entity);if(model)return model;
      }
      const T = this.T, group = new T.Group();
      const geometryStart = this._geometries.length;
      const kind = police ? 'compact' : entity.kind;
      const dimensions = root.MayhemCore.CAR_TYPES[kind] || root.MayhemCore.CAR_TYPES.compact;
      const length = dimensions.length / UNIT, width = dimensions.width / UNIT;
      const body = this._material(police ? '#eff1de' : entity.color);
      const glass = this._material('#527c91');
      const under = this._material('#485767'), tires = this._material('#354555');
      this._box(group, under, 0, 0.38, 0, length * 0.94, 0.30, width * 0.91);
      const shell = this._box(group, body, 0, 0.65, 0, length, 0.45, width);
      const hood = this._box(group, body, length * 0.33, 0.87, 0, length * 0.30, 0.12, width * 0.96);
      const windows = this._box(group, glass, -0.19, kind === 'van' ? 1.225 : 1.00, 0, length * (kind === 'van' ? 0.67 : 0.47), kind === 'van' ? 0.84 : 0.41, width * 0.78);
      this._box(group, body, -0.20, kind === 'van' ? 1.60 : 1.22, 0, length * (kind === 'van' ? 0.69 : 0.48), 0.11, width * 0.84);
      // Slim pillars split the windows, and two bumpers frame the chunky body.
      for (const side of [-1, 1]) {
        this._box(group, body, -0.19, kind === 'van' ? 1.225 : 1.02, side * width * 0.405, 0.08, kind === 'van' ? 0.84 : 0.46, 0.055, false);
        this._box(group, '#f2edce', length / 2 + 0.012, 0.73, side * width * 0.30, 0.06, 0.17, 0.24, false);
        this._box(group, '#eb8781', -length / 2 - 0.012, 0.72, side * width * 0.30, 0.06, 0.15, 0.23, false);
        this._box(group, under, 0.13, 0.87, side * width * 0.50, 0.16, 0.04, 0.018, false);
      }
      const bumpers = [
        this._box(group, '#e9e4d3', length / 2 + 0.04, 0.44, 0, 0.12, 0.12, width * 0.91),
        this._box(group, '#e9e4d3', -length / 2 - 0.04, 0.44, 0, 0.12, 0.12, width * 0.91)
      ];
      if (kind === 'sports') this._box(group, body, -length * 0.43, 1.04, 0, 0.15, 0.07, width * 1.08);
      const wheels = [];
      for (const front of [-1, 1]) for (const side of [-1, 1]) {
        const wheel = new T.Group();
        wheel.position.set(front * length * 0.30, 0.32, side * width * 0.49);
        const tire = this._mesh(this._cylinder, tires, wheel, 0, 0, 0, 0.31, 0.21, 0.31);
        tire.rotation.x = Math.PI / 2;
        const rim = this._mesh(this._cylinder, this._material('#e4e6df'), wheel, 0, 0, side * 0.115, 0.16, 0.018, 0.16, false);
        rim.rotation.x = Math.PI / 2;
        this._box(wheel, '#80939d', 0, 0, side * 0.132, 0.06, 0.28, 0.015, false);
        group.add(wheel); wheels.push(wheel);
      }
      let red = null, blue = null;
      if (police) {
        this._box(group, '#48677f', 0, 0.64, 0, length * 0.92, 0.17, width * 1.01, false);
        this._box(group, '#465d70', -0.12, 1.31, 0, 0.23, 0.07, 0.90);
        red = this._box(group, this._material('#ff7d89', { unlit: true }), -0.12, 1.39, -0.24, 0.19, 0.13, 0.35, false);
        blue = this._box(group, this._material('#84d5ff', { unlit: true }), -0.12, 1.39, 0.24, 0.19, 0.13, 0.35, false);
      }
      for (const wheel of wheels) this._mergeColored(wheel);
      const paint = this._mergeColored(group, [shell, hood, windows, ...bumpers, red, blue], body);
      const cracks = new T.Group(); cracks.name = 'Cracked vehicle windows';
      // White fissures sit just outside both side windows and the windshield.
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const crack = this._box(cracks, '#bfced1', -0.3 + i * 0.13, windows.position.y + (i - 1) * 0.05,
          side * width * 0.393, 0.018, 0.18, 0.009, false);
        crack.rotation.z = (i % 2 ? -0.7 : 0.5) * side;
      }
      for (let i = 0; i < 3; i++) {
        const crack = this._box(cracks, '#bfced1', windows.position.x + windows.scale.x / 2 + 0.006,
          windows.position.y + (i - 1) * 0.045, (i - 1) * width * 0.11, 0.009, 0.21, 0.017, false);
        crack.rotation.x = i % 2 ? 0.6 : -0.7;
      }
      this._mergeColored(cracks); cracks.visible = false; group.add(cracks);
      // Physics rotates about the chassis centre. Keep the original visual
      // coordinates inside a child, so a roll never orbits the model's feet.
      const centerHeight = (entity.colliderHeight || (kind === 'van' ? 1.7 : 1.3)) / 2;
      const pivot = new T.Group();
      group.position.y = 0.04 - centerHeight; pivot.add(group);
      this.scene.add(pivot);
      // Each car owns the few mutable materials; changing one car never changes
      // another car which happens to share its original paint or glass color.
      const damageBody = body.clone(), damageGlass = glass.clone(), damageTrim = bumpers[0].material.clone();
      this._materials.set('vehicle-body-' + entity.id, damageBody);
      this._materials.set('vehicle-glass-' + entity.id, damageGlass);
      this._materials.set('vehicle-trim-' + entity.id, damageTrim);
      const originals = [shell, hood, windows, ...bumpers].map(mesh => ({ mesh,
        position: mesh.position.clone(), scale: mesh.scale.clone(), rotation: mesh.rotation.clone(), material: mesh.material }));
      const model = { group: pivot, visual: group, centerHeight, length, width, wheels, shell, hood, windows, bumpers, cracks,
        body, paint, baseColors: paint && Float32Array.from(paint.mesh.geometry.attributes.color.array),
        damageBody, damageGlass, damageTrim, originals, color: entity.color, red, blue, police, roll: 0,
        damageKey: null, fireAnchor: new T.Vector3() };
      model.effects = this._makeVehicleEffects(entity.id);
      model.geometries = this._geometries.slice(geometryStart);
      root.MayhemMilitaryRender?.decorateVehicle?.(this,entity,model);
      return model;
    }

    _aircraftModel(entity) {
      const T = this.T, group = new T.Group(), visual = new T.Group();
      const type = entity.aircraftType || entity.type || entity.kind;
      const aliases = { news: 'newsHelicopter', policeheli: 'policeHelicopter', transportheli: 'transportHelicopter' };
      const assets = root.MayhemAircraftModels || {};
      const asset = assets[type] || assets[aliases[type]];
      const definition = root.MayhemAircraft?.AIRCRAFT_TYPES?.[type] || {};
      const parts = [], materials = [];
      group.name = 'Aircraft ' + entity.id; visual.name = type; group.add(visual);
      this._aircraftGeometries ??= new Map();
      // Blender exports each named mesh around its own origin. Geometry remains
      // shared by the fleet; only an aircraft's mutable damage palette is owned.
      for (let i = 0; i < (asset?.parts.length || 0); i++) {
        const part = asset.parts[i], key = type + ':' + i;
        let geometry = this._aircraftGeometries.get(key);
        if (!geometry) {
          geometry = this._geometry(new T.BufferGeometry());
          geometry.setAttribute('position', new T.Float32BufferAttribute(part.positions, 3));
          if (part.indices?.length) geometry.setIndex(part.indices);
          geometry.computeVertexNormals(); geometry.computeBoundingSphere();
          this._aircraftGeometries.set(key, geometry);
        }
        const material = this._material(part.color || entity.color || '#e8e3ca').clone();
        materials.push({ material, color: material.color.clone() });
        const mesh = new T.Mesh(geometry, material);
        mesh.name = part.name || 'Airframe';
        mesh.position.fromArray(part.pivot || [0, 0, 0]);
        mesh.castShadow = mesh.receiveShadow = true; visual.add(mesh);
        parts.push({ mesh, animation: part.animation || (/propeller/i.test(part.name) ? 'propeller' : /tail.*rotor/i.test(part.name) ? 'tailRotor' : /rotor/i.test(part.name) ? 'mainRotor' : null) });
      }
      // Keep a visible recovery silhouette if a locally cached page predates
      // the model bundle; normal game builds always use the Blender meshes.
      if (!parts.length) {
        const helicopter = ['helicopter', 'news', 'policeheli', 'transportheli'].includes(type);
        this._box(visual, entity.color || '#e8e3ca', 0, 1.3, 0, helicopter ? 4.4 : 6, 1.35, 1.45);
        this._box(visual, '#517d94', 1.5, 1.55, 0, 1.1, .72, 1.5);
        this._box(visual, '#e8e3ca', -2.8, 1.5, 0, 3.8, .27, .35);
        const rotor = new T.Group(); rotor.position.set(0, helicopter ? 2.8 : 1.3, 0);
        if (!helicopter) rotor.position.x = 3.2;
        this._box(rotor, '#394957', 0, 0, 0, helicopter ? 8 : .12, helicopter ? .10 : 2.6, .12);
        visual.add(rotor); parts.push({ mesh: rotor, animation: helicopter ? 'mainRotor' : 'propeller' });
        if (!helicopter) this._box(visual, '#e8e3ca', .1, 1.7, 0, 1.3, .17, 9);
      }
      const dimensions = asset?.bounds || { length: definition.length / UNIT, width: definition.width / UNIT };
      const model = { group, visual, type, parts, materials, length: dimensions.length || 7, width: dimensions.width || 9,
        fireAnchor: new T.Vector3(), phase: 0, effects: this._makeVehicleEffects('aircraft-' + entity.id) };
      if (type === 'fighter') {
        model.exhaust = this._mesh(this._cone, this._material('#ffa94f', { unlit: true, opacity: .78, depthWrite: false }), visual,
          -model.length * .47, 1.1, 0, .32, 1, .32, false);
        model.exhaust.rotation.z = Math.PI / 2; model.exhaust.raycast = () => {};
      }
      if (type === 'policeheli') {
        const beam = new T.Group(); beam.name = 'Police searchlight';
        const cone = this._mesh(this._cone, this._material('#fff4ad', { unlit: true, opacity: .09, depthWrite: false }), beam, 0, 0, 0, 1, 1, 1, false);
        const pool = this._mesh(this._cylinder, this._material('#fff1a5', { unlit: true, opacity: .20, depthWrite: false }), beam, 0, 0, 0, 1, .02, 1, false);
        cone.raycast = pool.raycast = () => {};
        this.scene.add(beam); model.searchlight = { group: beam, cone, pool, origin: new T.Vector3(), target: new T.Vector3(), direction: new T.Vector3(), up: new T.Vector3(0, 1, 0) };
        model.muzzle = this._mesh(this._sphere, this._material('#ffe9a2', { unlit: true }), visual, .3, 1.42, 1.84, .20, .20, .55, false);
        model.muzzle.visible = false;
      }
      this.scene.add(group);
      return model;
    }

    _aircraftArmament(model,entity) {
      const playerArmed = entity.id === this.game.player.vehicleId && Boolean(root.MayhemAircraft?.weaponsFor(entity));
      if (playerArmed && !model.playerMuzzle) {
        model.playerMuzzle = this._mesh(this._sphere, this._material('#ffe9a2', { unlit: true }), model.group,
          root.MayhemAircraft.getModel(entity).length * .52 / UNIT, 1.5, 0, .48, .13, .13, false);
        model.playerMuzzle.raycast = () => {};
      }
      if (model.playerMuzzle) model.playerMuzzle.visible = playerArmed && model.group.visible && !entity.exploded && Boolean(entity.gunFiring) &&
        (this.reducedMotion || Math.sin((this.game.time || 0) * 38) > 0);
      const armed=Boolean(entity.militaryResponse&&['interceptor','gunship'].includes(entity.militaryRole));
      if(armed&&!model.militaryArmament) {
        const T=this.T,group=new T.Group(),source=root.MayhemAircraftModels?.policeheli;
        group.name='Northwatch '+entity.militaryRole+' cannon';
        // Reuse the authored Blender cannon; changing duty does not create a
        // different airframe or change the aircraft's physical dimensions.
        for(let i=0;i<(source?.parts.length||0);i++) {
          const part=source.parts[i];if(!/gunner|cannon/i.test(part.name))continue;
          const key='policeheli:'+i;let geometry=this._aircraftGeometries.get(key);
          if(!geometry) {
            geometry=this._geometry(new T.BufferGeometry());
            geometry.setAttribute('position',new T.Float32BufferAttribute(part.positions,3));geometry.setIndex(part.indices);
            geometry.computeVertexNormals();geometry.computeBoundingSphere();this._aircraftGeometries.set(key,geometry);
          }
          const material=this._material(part.color).clone(),mesh=new T.Mesh(geometry,material);
          mesh.name=part.name;mesh.position.fromArray(part.pivot||[0,0,0]);mesh.castShadow=mesh.receiveShadow=true;
          model.materials.push({material,color:material.color.clone()});group.add(mesh);
        }
        if(entity.militaryRole==='interceptor'){group.rotation.y=Math.PI/2;group.position.set(4.7,.3,.5);}
        else group.position.set(0,.4,.4);
        model.visual.add(group);
        const muzzle=this._mesh(this._sphere,this._material('#ffe9a2',{unlit:true}),group,.3,1.42,1.88,.20,.20,.48,false);
        muzzle.raycast=()=>{};muzzle.visible=false;model.militaryArmament={group,muzzle};
      }
      if(model.militaryArmament) {
        model.militaryArmament.group.visible=armed;
        model.militaryArmament.muzzle.visible=armed&&!playerArmed&&model.group.visible&&!entity.exploded&&Boolean(entity.gunFiring)&&
          (this.reducedMotion||Math.sin((this.game.time||0)*38)>0);
      }
    }

    _retireAircraft(id, model) {
      model.group.visible = model.effects.group.visible = false;
      if (model.searchlight) model.searchlight.group.visible = false;
      this.scene.remove(model.group, model.effects.group);
      if (model.searchlight) this.scene.remove(model.searchlight.group);
      for (const entry of model.materials) entry.material.dispose();
      const key = 'vehicle-flash-aircraft-' + id, flash = this._materials.get(key);
      flash?.dispose(); this._materials.delete(key);
      model.effects.flames.dispose(); model.effects.smoke.dispose();
      this._aircraft.delete(id);
    }

    _aircraftStep(dt) {
      this._aircraft ??= new Map();
      const active = new Set();
      for (const entity of this.game.aircraft || []) {
        active.add(entity.id);
        let model = this._aircraft.get(entity.id);
        const type = entity.aircraftType || entity.type || entity.kind;
        if (model && model.type !== type) { this._retireAircraft(entity.id, model); model = null; }
        if (!model) { model = this._aircraftModel(entity); this._aircraft.set(entity.id, model); }
        model.group.visible = entity.visible !== false;
        this._aircraftArmament(model,entity);
        model.group.position.set(entity.x / UNIT, Number.isFinite(entity.elevation) ? entity.elevation : 0, entity.y / UNIT);
        // Heading is world yaw, with pitch and bank applied around the airframe's
        // local axes. The camera never inherits either of these rotations.
        model.group.rotation.set(0, -(entity.angle || 0), 0);
        model.visual.rotation.set(entity.roll || 0, 0, entity.pitch || 0, 'YZX');
        const powered = !entity.destroyed && !entity.exploded && (entity.engineOn !== false) && ((entity.throttle || 0) > .01 || entity.rotorSpeed > .01 || entity.flightPhase && !['parked', 'boarding'].includes(entity.flightPhase) || entity.id === this.game.player.vehicleId);
        model.phase += powered ? dt * 32 : 0;
        for (const part of model.parts) {
          const phase = powered && Number.isFinite(entity.rotorAngle) && part.animation !== 'propeller' ? entity.rotorAngle : model.phase;
          if (part.animation === 'mainRotor') part.mesh.rotation.y = phase;
          if (part.animation === 'tailRotor') part.mesh.rotation.z = phase * 1.7;
          if (part.animation === 'propeller') part.mesh.rotation.x = phase * 1.3;
        }
        const condition = clamp((entity.health ?? 100) / (entity.maxHealth || 100), 0, 1);
        for (const entry of model.materials) entry.material.color.copy(entry.color).multiplyScalar(entity.exploded ? .13 : .45 + condition * .55);
        if (model.exhaust) {
          model.exhaust.visible = powered && entity.throttle > .3;
          model.exhaust.scale.y = .5 + (entity.throttle || 0) * (this.reducedMotion ? 1 : 1.3 + Math.sin((this.game.time || 0) * 21) * .12);
        }
        this._vehicleEffects(model, { ...entity, engineHealth: entity.engineHealth ?? condition * 100 });
        model.effects.group.visible &&= model.group.visible;
        if (model.muzzle) model.muzzle.visible = entity.id !== this.game.player.vehicleId && model.group.visible && Boolean(entity.gunFiring) && (this.reducedMotion || Math.sin((this.game.time || 0) * 38) > 0);
        if (model.searchlight) {
          const beam = model.searchlight;
          beam.group.visible = model.group.visible && Boolean(entity.searchlight) && !entity.exploded;
          if (beam.group.visible) {
            model.group.updateWorldMatrix(true, true);
            beam.origin.set(1.85, .63, -.35); model.visual.localToWorld(beam.origin);
            const target = entity.lastSeen;
            const tx = target?.x / UNIT, tz = target?.y / UNIT;
            const distance = target ? Math.hypot(tx - beam.origin.x, tz - beam.origin.z) : Infinity;
            beam.target.set(distance < 120 ? tx : beam.origin.x + Math.cos(entity.angle || 0) * 5,
              distance < 120 ? target.elevation || this._surfaceY(tx, tz) : this._surfaceY(beam.origin.x, beam.origin.z),
              distance < 120 ? tz : beam.origin.z + Math.sin(entity.angle || 0) * 5);
            beam.direction.copy(beam.origin).sub(beam.target);
            const length = Math.max(.1, beam.direction.length()), radius = clamp(length * .12, 1.5, 9);
            beam.cone.position.copy(beam.origin).add(beam.target).multiplyScalar(.5);
            beam.cone.quaternion.setFromUnitVectors(beam.up, beam.direction.normalize());
            beam.cone.scale.set(radius, length, radius);
            beam.pool.position.copy(beam.target); beam.pool.position.y += .05; beam.pool.scale.set(radius, .02, radius);
          }
        }
      }
      for (const [id, model] of this._aircraft) if (!active.has(id)) this._retireAircraft(id, model);
      if (this.canvas?.dataset) this.canvas.dataset.aircraftCount = String(active.size);
    }

    _mergeColored(group, preserve = [], paintMaterial = null) {
      const T = this.T;
      const pieces = group.children.filter(child => child.isMesh && !preserve.includes(child) && !child.material.isMeshBasicMaterial);
      if (pieces.length < 2) return;
      let vertices = 0, indices = 0;
      for (const piece of pieces) { vertices += piece.geometry.attributes.position.count; indices += piece.geometry.index ? piece.geometry.index.count : piece.geometry.attributes.position.count; }
      const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), colors = new Float32Array(vertices * 3);
      const index = vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
      const vector = new T.Vector3(), normal = new T.Vector3(), normalMatrix = new T.Matrix3();
      let offset = 0, indexOffset = 0;
      const ranges = [];
      for (const piece of pieces) {
        piece.updateMatrix(); normalMatrix.getNormalMatrix(piece.matrix);
        const p = piece.geometry.attributes.position, n = piece.geometry.attributes.normal, color = piece.material.color;
        if (paintMaterial && piece.material === paintMaterial) ranges.push({ start: offset, count: p.count });
        for (let i = 0; i < p.count; i++) {
          vector.fromBufferAttribute(p, i).applyMatrix4(piece.matrix);
          normal.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
          const at = (offset + i) * 3;
          positions[at] = vector.x; positions[at + 1] = vector.y; positions[at + 2] = vector.z;
          normals[at] = normal.x; normals[at + 1] = normal.y; normals[at + 2] = normal.z;
          colors[at] = color.r; colors[at + 1] = color.g; colors[at + 2] = color.b;
        }
        const sourceIndex = piece.geometry.index;
        const count = sourceIndex ? sourceIndex.count : p.count;
        for (let i = 0; i < count; i++) index[indexOffset++] = offset + (sourceIndex ? sourceIndex.getX(i) : i);
        offset += p.count; group.remove(piece);
      }
      const geometry = this._geometry(new T.BufferGeometry());
      geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
      geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
      geometry.setIndex(new T.BufferAttribute(index, 1));
      geometry.computeBoundingSphere();
      if (!this._materials.has('vertex-colors')) this._materials.set('vertex-colors', new T.MeshLambertMaterial({ color: '#ffffff', flatShading: true, vertexColors: true }));
      const mesh = new T.Mesh(geometry, this._materials.get('vertex-colors'));
      mesh.castShadow = true; mesh.receiveShadow = true;
      // All piece transforms were baked into the vertices; animation belongs
      // to the containing limb, wheel, gate arm or vehicle group.
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      return { mesh, ranges };
    }

    _paintVehicle(model, color) {
      if (model.police || model.color === color) return;
      model.color = color;
      model.body = this._material(color);
      // Only paintable body vertices change: windows, lights, trim, and tires keep
      // their colors. The merged geometry and its buffers survive every repaint.
      const paint = model.paint;
      if (!paint?.ranges.length) return;
      const colors = paint.mesh.geometry.attributes.color, value = model.body.color;
      for (const range of paint.ranges) {
        for (let i = range.start; i < range.start + range.count; i++) {
          colors.setXYZ(i, value.r, value.g, value.b);
          model.baseColors[i * 3] = value.r; model.baseColors[i * 3 + 1] = value.g; model.baseColors[i * 3 + 2] = value.b;
        }
      }
      colors.needsUpdate = true;
      model.damageKey = null;
    }

    _makeVehicleEffects(id) {
      const T = this.T, group = new T.Group(); group.name = 'Vehicle fire and smoke'; group.visible = false;
      const flames = new T.InstancedMesh(this._cone, this._material('#ffffff', { unlit: true }), 12);
      const smoke = new T.InstancedMesh(this._sphere, this._material('#464b50', { unlit: true, opacity: 0.52, depthWrite: false }), 12);
      for (const mesh of [flames, smoke]) {
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.frustumCulled = false; mesh.count = 0;
      }
      const flashMaterial = this._material('#ffaf36', { unlit: true, opacity: 0.9, depthWrite: false }).clone();
      this._materials.set('vehicle-flash-' + id, flashMaterial);
      const flash = this._mesh(this._sphere, flashMaterial, group, 0, 0, 0, 1, 1, 1, false); flash.visible = false;
      group.add(flames, smoke); this.scene.add(group);
      return { group, flames, smoke, flash, dummy: new T.Object3D(), color: new T.Color(), blastOrigin: new T.Vector3(), explosionTime: null };
    }

    _retireVehicle(id, model) {
      model.group.visible = model.effects.group.visible = false;
      this.scene.remove(model.group, model.effects.group);
      this._vehicles.delete(id);
      // The body, window cracks and merged wheels own their buffers; the basic
      // shapes and original palette materials remain shared by the whole town.
      const owned = new Set(model.geometries);
      for (const geometry of owned) geometry.dispose();
      this._geometries = this._geometries.filter(geometry => !owned.has(geometry));
      for (const key of ['vehicle-body-', 'vehicle-glass-', 'vehicle-trim-', 'vehicle-flash-']) {
        const name = key + id, material = this._materials.get(name);
        material?.dispose(); this._materials.delete(name);
      }
      model.effects.flames.dispose?.(); model.effects.smoke.dispose?.();
    }

    _damageVehicle(model, entity) {
      const health = Number.isFinite(entity.health) ? entity.health : 100;
      const maxHealth = Number.isFinite(entity.maxHealth) && entity.maxHealth > 0 ? entity.maxHealth : 100;
      const damage = entity.exploded ? 1 : 1 - (VehicleStats ? VehicleStats.condition(entity) : clamp(health / maxHealth, 0, 1));
      const scorch = entity.exploded ? 0.94 : entity.burning ? clamp(0.25 + (entity.fireTime || 0) * 0.09, 0.25, 0.88) : 0;
      const key = damage + ':' + scorch + ':' + model.color;
      if (model.damageKey === key) return;
      model.damageKey = key;
      for (const original of model.originals) {
        original.mesh.position.copy(original.position); original.mesh.scale.copy(original.scale); original.mesh.rotation.copy(original.rotation);
        original.mesh.material = original.material;
      }
      // Damage stays inside the physical chassis pivot and can be fully undone.
      model.shell.scale.x *= 1 - damage * 0.13; model.shell.scale.y *= 1 - damage * 0.26;
      model.shell.rotation.z = damage * 0.055; model.shell.rotation.x = damage * 0.045;
      model.hood.position.x -= damage * model.length * 0.085; model.hood.position.y += damage * 0.11;
      model.hood.scale.x *= 1 - damage * 0.36; model.hood.scale.z *= 1 - damage * 0.09;
      model.hood.rotation.z = damage * 0.33; model.hood.rotation.x = damage * 0.12;
      model.windows.scale.y *= 1 - damage * 0.17; model.windows.rotation.z = damage * -0.035;
      for (let i = 0; i < model.bumpers.length; i++) {
        const bumper = model.bumpers[i]; bumper.position.x += (i ? 1 : -1) * damage * model.length * 0.085;
        bumper.position.y -= damage * (i ? 0.035 : 0.09); bumper.rotation.x = damage * (i ? -0.11 : 0.18);
        bumper.rotation.y = damage * (i ? 0.09 : -0.14); bumper.scale.z *= 1 - damage * 0.14;
      }
      model.cracks.visible = damage > 0.22 && !entity.exploded;
      model.damageBody.color.copy(model.body.color).multiplyScalar(1 - damage * 0.24).lerp(this._color.set('#252a2e'), scorch);
      model.damageGlass.color.copy(model.originals[2].material.color).multiplyScalar(1 - damage * 0.46).lerp(this._color.set('#20272b'), scorch);
      model.damageTrim.color.copy(model.originals[3].material.color).multiplyScalar(1 - damage * 0.26).lerp(this._color.set('#343a3d'), scorch);
      const changed = damage > 0 || scorch > 0;
      model.shell.material = changed ? model.damageBody : model.body;
      model.hood.material = changed ? model.damageBody : model.body;
      model.windows.material = changed ? model.damageGlass : model.originals[2].material;
      for (const bumper of model.bumpers) bumper.material = changed ? model.damageTrim : model.originals[3].material;
      // Keep the familiar disabled chassis shade for a cold, intact wreck.
      if (health <= 0 && !entity.burning && !entity.exploded) model.damageBody.color.set('#8f9aa1');
      if (model.paint && model.baseColors) {
        const colors = model.paint.mesh.geometry.attributes.color;
        const dark = 1 - damage * 0.19, char = this._color.set('#252a2e');
        for (let i = 0; i < colors.count; i++) {
          const at = i * 3;
          colors.setXYZ(i, mix(model.baseColors[at] * dark, char.r, scorch), mix(model.baseColors[at + 1] * dark, char.g, scorch), mix(model.baseColors[at + 2] * dark, char.b, scorch));
        }
        colors.needsUpdate = true;
      }
      if (model.police) {
        model.red.visible = model.blue.visible = !entity.exploded;
      }
    }

    _vehicleEffects(model, entity) {
      const effect = model.effects, now = Number.isFinite(this.game.time) ? this.game.time : 0;
      const engine = Number.isFinite(entity.engineHealth) ? entity.engineHealth : 100;
      const explosionTime = Number.isFinite(entity.explosionTime) && entity.exploded ? entity.explosionTime : null;
      const age = explosionTime === null ? Infinity : now - explosionTime;
      const blast = age >= 0 && age < 1.7;
      const burning = Boolean(entity.burning && !entity.exploded);
      const smoking = !entity.exploded && (burning || engine < 45);
      effect.group.visible = burning || smoking || blast;
      effect.flames.visible = burning; effect.flames.count = burning ? 12 : 0;
      effect.smoke.visible = smoking || blast;
      effect.flash.visible = blast && age < (this.reducedMotion ? 0.6 : 0.8);
      if (!effect.group.visible) { effect.smoke.count = 0; effect.explosionTime = explosionTime; return; }
      model.group.updateWorldMatrix(true, false);
      model.visual.updateWorldMatrix(true, false);
      model.fireAnchor.set(model.length * 0.30, 0.93, 0); model.visual.localToWorld(model.fireAnchor);
      if (explosionTime !== effect.explosionTime) {
        effect.explosionTime = explosionTime; effect.blastOrigin.copy(model.fireAnchor);
      }
      // Plumes and flames rise in world space even when the chassis is upside down.
      effect.group.position.copy(blast ? effect.blastOrigin : model.fireAnchor);
      const time = this.reducedMotion ? 0 : now, dummy = effect.dummy, color = effect.color;
      if (burning) {
        for (let i = 0; i < 6; i++) {
          const phase = time * 6.8 + i * 1.7, height = 0.8 + i % 3 * 0.18 + Math.sin(phase) * 0.17;
          const x = (i % 3 - 1) * 0.24, z = (i < 3 ? -1 : 1) * model.width * 0.22;
          dummy.position.set(x + Math.sin(phase * 0.7) * 0.045, height / 2 - 0.06, z);
          dummy.rotation.set(Math.sin(phase) * 0.07, i, Math.cos(phase) * 0.09);
          dummy.scale.set(0.22, height, 0.24); dummy.updateMatrix();
          effect.flames.setMatrixAt(i * 2, dummy.matrix); color.set('#ff7925'); effect.flames.setColorAt(i * 2, color);
          dummy.scale.set(0.12, height * 0.66, 0.13); dummy.position.y = height * 0.33 - 0.08; dummy.updateMatrix();
          effect.flames.setMatrixAt(i * 2 + 1, dummy.matrix); color.set('#ffe893'); effect.flames.setColorAt(i * 2 + 1, color);
        }
        effect.flames.instanceMatrix.needsUpdate = true; effect.flames.instanceColor.needsUpdate = true;
      }
      let smokeCount = 0;
      if (smoking) {
        const intensity = burning ? 1 : clamp((45 - engine) / 45, 0.1, 1);
        for (let i = 0; i < 8; i++) {
          const rise = (time * 0.7 + i / 8) % 1, size = (0.22 + rise * 0.62) * intensity;
          dummy.position.set(Math.sin(i * 2.1 + time * 0.35) * rise * 0.42, 0.5 + rise * 3.8, Math.cos(i * 1.3) * rise * 0.32);
          dummy.rotation.set(i, 0, i * 0.4); dummy.scale.set(size, size * 0.9, size); dummy.updateMatrix();
          effect.smoke.setMatrixAt(smokeCount++, dummy.matrix);
        }
      }
      if (blast) {
        for (let i = 0; i < 4; i++) {
          const radius = this.reducedMotion ? 1.1 : 0.5 + age * 1.8;
          const rise = this.reducedMotion ? 1.1 : age * 1.5;
          dummy.position.set(Math.cos(i * Math.PI / 2) * radius * 0.62, rise + 0.4, Math.sin(i * Math.PI / 2) * radius * 0.62);
          dummy.rotation.set(i, 0, 0); dummy.scale.setScalar(radius * Math.max(0.05, 1 - age / 1.7)); dummy.updateMatrix();
          effect.smoke.setMatrixAt(smokeCount++, dummy.matrix);
        }
        const radius = this.reducedMotion ? 1.1 : 0.45 + Math.min(age, 0.55) * 4.5;
        effect.flash.scale.set(radius, radius * 0.82, radius);
        effect.flash.position.y = this.reducedMotion ? 0.4 : age * 0.6;
        effect.flash.material.opacity = Math.max(0, 0.88 * (1 - age / 0.8));
      }
      effect.smoke.count = smokeCount; effect.smoke.instanceMatrix.needsUpdate = true;
    }

    _bubble() {
      const T = this.T, canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 128;
      const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
      this._textures.push(texture);
      const material = new T.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false });
      const materialKey='bubble-'+(this._nextBubbleId=(this._nextBubbleId||0)+1);
      this._materials.set(materialKey, material);
      const sprite = new T.Sprite(material);
      sprite.position.set(0, 2.27, 0); sprite.scale.set(3.2, 0.80, 1); sprite.visible = false;
      return { canvas, texture, sprite, text: '', materialKey };
    }

    _bubbleText(bubble, text) {
      bubble.sprite.visible = Boolean(text);
      if (bubble.text === text) return;
      bubble.text = text;
      const ctx = bubble.canvas.getContext('2d');
      ctx.clearRect(0, 0, 512, 128);
      if (text) {
        ctx.fillStyle = '#fff5de'; ctx.strokeStyle = '#53647a'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.roundRect(5, 4, 502, 99, 23); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(232, 100); ctx.lineTo(247, 123); ctx.lineTo(264, 100); ctx.fill();
        ctx.fillStyle = '#3f4e65'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '900 34px system-ui, sans-serif';
        const fit = Math.min(1, 455 / ctx.measureText(text).width);
        ctx.font = '900 ' + Math.floor(34 * fit) + 'px system-ui, sans-serif';
        ctx.fillText(text, 256, 56);
      }
      bubble.texture.needsUpdate = true;
    }

    _makeTarget() {
      const T = this.T;
      this._target = new T.Group();
      this._targetRing = this._mesh(this._ringGeometry, this._material('#ffec8d', { unlit: true }), this._target, 0, 0.08, 0, 1, 1, 1, false);
      this._targetRing.rotation.x = -Math.PI / 2;
      this._targetBeam = this._mesh(this._cylinder, this._material('#ffeaa1', { unlit: true, opacity: 0.18, depthWrite: false }), this._target, 0, 3, 0, 0.55, 6, 0.55, false);
      this._targetDiamond = this._mesh(this._geometry(new T.OctahedronGeometry(0.40)), this._material('#ffe88a', { unlit: true }), this._target, 0, 3.4, 0, 1, 1, 1, false);
      this._target.visible = false;
      this.scene.add(this._target);
    }

    resize(width, height) {
      this.width = Math.max(1, width); this.height = Math.max(1, height);
      this.renderer.setSize(this.width, this.height, false);
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }

    orbit(dx, dy, options = {}) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const sensitivity = Number.isFinite(options.sensitivity) ? clamp(options.sensitivity, 0.1, 3) : 1;
      const delta = dx * 0.004 * sensitivity;
      if (this.game.player.vehicleId) this._driveOffset = angle(this._driveOffset + delta);
      else this._requestedYaw = angle(this._requestedYaw + delta);
      this._pitch = clamp(this._pitch - dy * 0.0035 * sensitivity * (options.invertY ? -1 : 1), -1.05, 0.85);
      if (dx || dy) this._orbitTimer = 1.25;
    }

    setAiming(aiming) { this._aiming = Boolean(aiming); }

    recenter() {
      this._requestedYaw = this.game.current.angle;
      this._driveOffset = 0;
      this._pitch = DEFAULT_PITCH;
      this._orbitTimer = 0;
    }

    _terrainRayPoint(target) {
      const field = this.game.world?.terrain;
      if (!field) return false;
      const T = this.T, ray = this._ray.ray, origin = ray.origin, direction = ray.direction;
      if (!this._terrainRayScratch) this._terrainRayScratch = {
        a: new T.Vector3(), b: new T.Vector3(), c: new T.Vector3(), d: new T.Vector3(), hit: new T.Vector3(), start: new T.Vector3()
      };
      const scratch = this._terrainRayScratch, count = field.count,rows=field.rows||count,step = field.step / UNIT, size = (count - 1) * step,depth=(rows-1)*step,ox=(field.originX||0)/UNIT,oz=(field.originY||0)/UNIT;
      let near = 0, far = this.camera.far || 950;
      // Walk only the cells crossed by the projected ray. This avoids testing
      // all 131,072 terrain triangles whenever the player moves the crosshair.
      for (const [position, delta,min,span] of [[origin.x, direction.x,ox,size], [origin.z, direction.z,oz,depth]]) {
        if (Math.abs(delta) < 1e-10) { if (position < min || position > min+span) return false; }
        else {
          let a = (min-position) / delta, b = (min+span - position) / delta;
          if (a > b) { const swap = a; a = b; b = swap; }
          near = Math.max(near, a); far = Math.min(far, b);
          if (far < near) return false;
        }
      }
      ray.at(near + 1e-7, scratch.start);
      let col = clamp(Math.floor((scratch.start.x-ox) / step), 0, count - 2), row = clamp(Math.floor((scratch.start.z-oz) / step), 0, rows - 2);
      const stepX = Math.sign(direction.x), stepZ = Math.sign(direction.z);
      const deltaX = Math.abs(direction.x) > 1e-10 ? step / Math.abs(direction.x) : Infinity;
      const deltaZ = Math.abs(direction.z) > 1e-10 ? step / Math.abs(direction.z) : Infinity;
      let nextX = Number.isFinite(deltaX) ? (ox+(col + (stepX > 0 ? 1 : 0)) * step - origin.x) / direction.x : Infinity;
      let nextZ = Number.isFinite(deltaZ) ? (oz+(row + (stepZ > 0 ? 1 : 0)) * step - origin.z) / direction.z : Infinity;
      for (let visited = 0; visited < count+rows+2 && col >= 0 && col < count - 1 && row >= 0 && row < rows - 1; visited++) {
        const index = row * count + col, end = Math.min(nextX, nextZ, far), x = ox+col * step, z = oz+row * step;
        scratch.a.set(x, field.heights[index], z);
        scratch.b.set(x + step, field.heights[index + 1], z);
        scratch.c.set(x, field.heights[index + count], z + step);
        scratch.d.set(x + step, field.heights[index + count + 1], z + step);
        let hitAt = Infinity;
        for (const triangle of [[scratch.a, scratch.c, scratch.b], [scratch.d, scratch.b, scratch.c]]) {
          if (!ray.intersectTriangle(triangle[0], triangle[1], triangle[2], false, scratch.hit)) continue;
          const distance = (scratch.hit.x - origin.x) * direction.x + (scratch.hit.y - origin.y) * direction.y + (scratch.hit.z - origin.z) * direction.z;
          if (distance >= near - 1e-6 && distance <= end + 1e-6 && distance < hitAt) { hitAt = distance; target.copy(scratch.hit); }
        }
        if (Number.isFinite(hitAt)) return true;
        if (end >= far) break;
        near = end;
        const crossX = nextX <= nextZ + 1e-9, crossZ = nextZ <= nextX + 1e-9;
        if (crossX) { col += stepX; nextX += deltaX; }
        if (crossZ) { row += stepZ; nextZ += deltaZ; }
      }
      return false;
    }

    _aimWorldPoint(pointerX, pointerY, width = this.width, height = this.height) {
      this._pointer.set(pointerX / Math.max(1, width) * 2 - 1, 1 - pointerY / Math.max(1, height) * 2);
      this._ray.setFromCamera(this._pointer, this.camera);
      let nearest = Infinity;
      const saveHit = point => {
        const distance = point.distanceToSquared(this._ray.ray.origin);
        if (distance < nearest) { nearest = distance; this._aimPoint.copy(point); }
      };
      // Rotated building rays use their physical footprint, without the extra
      // camera clearance. People and vehicles use their actual rendered meshes
      // so the shoulder shot converges on the crosshair's subject.
      for (const box of this._buildingVolumes) {
        if (box.object?.destroyed) continue;
        const cx = box.cx ?? (box.minX + box.maxX) / 2, cz = box.cz ?? (box.minZ + box.maxZ) / 2;
        const cosine = box.cosine ?? 1, sine = box.sine ?? 0;
        const halfX = box.physicalHalfX ?? box.halfX ?? (box.maxX - box.minX) / 2, halfZ = box.physicalHalfZ ?? box.halfZ ?? (box.maxZ - box.minZ) / 2;
        const origin = this._ray.ray.origin, direction = this._ray.ray.direction;
        this._localAimRay.origin.set(
          (origin.x - cx) * cosine + (origin.z - cz) * sine, origin.y, -(origin.x - cx) * sine + (origin.z - cz) * cosine
        );
        this._localAimRay.direction.set(direction.x * cosine + direction.z * sine, direction.y, -direction.x * sine + direction.z * cosine);
        this._aimBox.min.set(-halfX, box.height ? box.foundationBottom ?? box.baseElevation ?? 0 : box.minY, -halfZ);
        this._aimBox.max.set(halfX, box.height ? (box.baseElevation ?? 0) + box.height : box.maxY, halfZ);
        if (this._localAimRay.intersectBox(this._aimBox, this._aimHit)) {
          const px = this._aimHit.x, pz = this._aimHit.z;
          this._aimHit.set(cx + px * cosine - pz * sine, this._aimHit.y, cz + px * sine + pz * cosine);
          saveHit(this._aimHit);
        }
      }
      const subjects = (this._propAimMeshes || []).filter(mesh => !mesh.propObject?.destroyed);
      subjects.push(...(this._bridgeAimMeshes || []));
      for (const model of this._residents?.values() || []) if (model.group.visible) subjects.push(model.group);
      for (const [id, model] of this._vehicles || []) if (model.group.visible && id !== this.game.player.vehicleId) subjects.push(model.group);
      for (const [id, model] of this._aircraft || []) if (model.group.visible && id !== this.game.player.vehicleId) subjects.push(model.visual);
      for (const group of subjects) group.updateWorldMatrix(true, true);
      for (const hit of this._ray.intersectObjects(subjects, true)) if (hit.object.isMesh) { saveHit(hit.point); break; }
      if (this._terrainRayPoint(this._aimHit)) saveHit(this._aimHit);
      const field = this.game.world?.terrain;
      if (this._ray.ray.intersectPlane(this._ground, this._aimHit)) {
        const x = this._aimHit.x * UNIT, y = this._aimHit.z * UNIT;
        if (!field || x < (field.originX||0) || y < (field.minY||0) || x > field.size || y > (field.maxY??field.size) || field.isWater(x, y)) saveHit(this._aimHit);
      }
      return Number.isFinite(nearest);
    }

    aimAngle(pointerX, pointerY, width = this.width, height = this.height) {
      const hit = this._aimWorldPoint(pointerX, pointerY, width, height);
      if (hit) {
        const dx = this._aimPoint.x * UNIT - this.game.player.x, dy = this._aimPoint.z * UNIT - this.game.player.y;
        // A steep downward view can intersect the ground behind the character.
        // Keep the forward heading rather than making the toy turn backwards.
        if (Math.hypot(dx, dy) > 20 && dx * Math.cos(this.viewYaw) + dy * Math.sin(this.viewYaw) > 0) return Math.atan2(dy, dx);
      }
      return this.viewYaw;
    }

    aimDirection() {
      const hit = this._aimWorldPoint(this.width / 2, this.height / 2);
      if (!hit) this._ray.ray.at(40, this._aimPoint);
      const dx = this._aimPoint.x - this.game.player.x / UNIT;
      const dz = this._aimPoint.z - this.game.player.y / UNIT;
      const forward = dx * Math.cos(this.viewYaw) + dz * Math.sin(this.viewYaw);
      if (Math.hypot(dx, dz) < 0.25 || forward <= 0) return { angle: this.viewYaw, pitch: this.viewPitch };
      const muzzleHeight = (Number.isFinite(this.game.player.elevation) ? this.game.player.elevation : 0) + MUZZLE_HEIGHT;
      return { angle: Math.atan2(dz, dx), pitch: Math.atan2(this._aimPoint.y - muzzleHeight, Math.hypot(dx, dz)) };
    }

    get viewYaw() { return this._cameraInfo.viewYaw; }
    get viewPitch() { return this._cameraInfo.viewPitch; }
    get cameraInfo() { return { ...this._cameraInfo }; }

    weaponTargetScreenPoint(target) {
      this._weaponTargetPoint ||= new this.T.Vector3();
      const height = target.kind === 'aircraft' ? root.MayhemAircraft?.getModel(target).height * .5 : 1.2;
      const point = this._weaponTargetPoint.set(target.x / UNIT, (target.elevation || 0) + (height || 1.2), target.y / UNIT).project(this.camera);
      if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
      return { x: (point.x + 1) * 50, y: (1 - point.y) * 50 };
    }
    get worldInfo() { return { ...this._worldInfo, districts: { ...this._worldInfo?.districts }, landscape: { ...this._worldInfo?.landscape } }; }
    get ragdollCount() { return this._ragdollRenderedCount; }

    _bodyFor(entity) { return this.game.ragdolls?.get(entity.id || 'player'); }

    // All fallen people share two instance buffers. Bone matrices follow the
    // physical joints, so repeated flops need no new geometry or draw batches.
    _makeRagdollInstances() {
      if (this._ragdollCubes) return;
      const T = this.T, material = this._material('#ffffff');
      this._ragdollCubes = new T.InstancedMesh(this._cube, material, 24 * 26);
      this._ragdollHeads = new T.InstancedMesh(this._sphere, material, 24);
      for (const mesh of [this._ragdollCubes, this._ragdollHeads]) {
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.frustumCulled = false; mesh.count = 0;
        this.scene.add(mesh);
      }
      this._ragdollDummy = new T.Object3D();
      this._ragdollScratch = {
        a: new T.Vector3(), b: new T.Vector3(), midpoint: new T.Vector3(),
        up: new T.Vector3(), right: new T.Vector3(), forward: new T.Vector3(),
        headUp: new T.Vector3(), headRight: new T.Vector3(), headForward: new T.Vector3(),
        offset: new T.Vector3(), matrix: new T.Matrix4(),
        torsoQuaternion: new T.Quaternion(), headQuaternion: new T.Quaternion(),
        limbQuaternion: new T.Quaternion(), vertical: new T.Vector3(0, 1, 0)
      };
    }

    _ragdollBox(position, quaternion, sx, sy, sz, color, ox = 0, oy = 0, oz = 0) {
      const dummy = this._ragdollDummy, scratch = this._ragdollScratch;
      dummy.position.copy(position);
      if (ox || oy || oz) dummy.position.add(scratch.offset.set(ox * CHARACTER_SCALE, oy * CHARACTER_SCALE, oz * CHARACTER_SCALE).applyQuaternion(quaternion));
      dummy.quaternion.copy(quaternion); dummy.scale.set(sx * CHARACTER_SCALE, sy * CHARACTER_SCALE, sz * CHARACTER_SCALE); dummy.updateMatrix();
      const index = this._ragdollCubeIndex++;
      this._ragdollCubes.setMatrixAt(index, dummy.matrix);
      this._color.set(color); this._ragdollCubes.setColorAt(index, this._color);
    }

    _ragdollBone(joints, from, to, width, depth, color) {
      const s = this._ragdollScratch;
      s.a.set(joints[from].x, joints[from].y, joints[from].z);
      s.b.set(joints[to].x, joints[to].y, joints[to].z).sub(s.a);
      const length = Math.max(0.025, s.b.length());
      s.midpoint.copy(s.a).addScaledVector(s.b, 0.5);
      if (s.b.lengthSq() > 0.000001) s.limbQuaternion.setFromUnitVectors(s.vertical, s.b.normalize());
      else s.limbQuaternion.copy(s.torsoQuaternion);
      this._ragdollBox(s.midpoint, s.limbQuaternion, depth, length / CHARACTER_SCALE, width, color);
    }

    _ragdollFrame(up, rightHint, quaternion) {
      const s = this._ragdollScratch;
      if (up.lengthSq() < 0.000001) up.copy(s.vertical); else up.normalize();
      s.right.copy(rightHint).addScaledVector(up, -rightHint.dot(up));
      if (s.right.lengthSq() < 0.000001) {
        s.right.set(Math.abs(up.x) < 0.85 ? 1 : 0, 0, Math.abs(up.x) < 0.85 ? 0 : 1);
        s.right.addScaledVector(up, -s.right.dot(up));
      }
      s.right.normalize(); s.forward.crossVectors(up, s.right).normalize();
      s.right.crossVectors(s.forward, up).normalize();
      s.matrix.makeBasis(s.forward, up, s.right); quaternion.setFromRotationMatrix(s.matrix);
    }

    _ragdollPose(body, model) {
      const j = body.joints, s = this._ragdollScratch;
      const shirt = model.color, skin = model.player ? '#f9c68f' : '#edbd93';
      const pants = model.player ? '#355267' : model.soldier ? '#526b53' : '#647386';
      const point = (vector, name) => vector.set(j[name].x, j[name].y, j[name].z);
      point(s.a, 'pelvis'); point(s.b, 'chest');
      s.up.copy(s.b).sub(s.a);
      const torsoLength = Math.max(0.12, s.up.length());
      point(s.right, 'rightShoulder').sub(point(s.forward, 'leftShoulder'));
      this._ragdollFrame(s.up, s.right, s.torsoQuaternion);
      s.midpoint.copy(s.a).add(s.b).multiplyScalar(0.5);
      this._ragdollBox(s.midpoint, s.torsoQuaternion, 0.36, torsoLength / CHARACTER_SCALE + 0.22, 0.48, shirt);
      point(s.a, 'pelvis');
      this._ragdollBox(s.a, s.torsoQuaternion, 0.30, 0.16, 0.38, pants, 0, -0.03, 0);
      if (model.player) {
        point(s.a, 'chest');
        this._ragdollBox(s.a, s.torsoQuaternion, 0.22, 0.43, 0.36, '#e48b83', -0.25, -0.13, 0);
        this._ragdollBox(s.a, s.torsoQuaternion, 0.035, 0.25, 0.23, '#f4d180', -0.375, -0.13, 0);
        for (const side of [-1, 1]) this._ragdollBox(s.a, s.torsoQuaternion, 0.04, 0.35, 0.04, '#fff1bd', -0.18, 0.10, side * 0.22);
      }
      for (const side of ['left', 'right']) {
        this._ragdollBone(j, side + 'Shoulder', side + 'Elbow', 0.18, 0.19, shirt);
        this._ragdollBone(j, side + 'Elbow', side + 'Hand', 0.15, 0.16, skin);
        point(s.a, side + 'Hand');
        this._ragdollBox(s.a, s.limbQuaternion, 0.15, 0.13, 0.16, skin);
        this._ragdollBone(j, side + 'Hip', side + 'Knee', 0.19, 0.18, pants);
        this._ragdollBone(j, side + 'Knee', side + 'Foot', 0.18, 0.18, pants);
        // The shoe frame uses the calf direction and the torso's side axis.
        point(s.up, side + 'Knee').sub(point(s.a, side + 'Foot'));
        s.right.set(0, 0, 1).applyQuaternion(s.torsoQuaternion);
        this._ragdollFrame(s.up, s.right, s.limbQuaternion);
        this._ragdollBox(s.a, s.limbQuaternion, 0.33, 0.14, 0.22, model.soldier?'#354555':'#f2efdf', 0.075, 0, 0);
      }
      point(s.a, 'head'); point(s.b, 'chest');
      s.headUp.copy(s.a).sub(s.b);
      s.headRight.set(0, 0, 1).applyQuaternion(s.torsoQuaternion);
      this._ragdollFrame(s.headUp, s.headRight, s.headQuaternion);
      const dummy = this._ragdollDummy;
      dummy.position.copy(s.a); dummy.quaternion.copy(s.headQuaternion); dummy.scale.set(0.235 * CHARACTER_SCALE, 0.26 * CHARACTER_SCALE, 0.23 * CHARACTER_SCALE); dummy.updateMatrix();
      this._ragdollHeads.setMatrixAt(this._ragdollHeadIndex, dummy.matrix);
      this._color.set(skin); this._ragdollHeads.setColorAt(this._ragdollHeadIndex++, this._color);
      const hat = model.player ? '#f1cf5d' : model.soldier ? '#526b53' : '#6f5b55';
      this._ragdollBox(s.a, s.headQuaternion, 0.37, 0.10, 0.42, hat, -0.02, 0.18, 0);
      this._ragdollBox(s.a, s.headQuaternion, 0.30, 0.055, 0.38, hat, 0.18, 0.16, 0);
      for (const side of [-1, 1]) this._ragdollBox(s.a, s.headQuaternion, 0.035, 0.055, 0.045, '#384657', 0.22, 0.01, side * 0.08);
    }

    _ragdollPeople() {
      const world = this.game.ragdolls;
      this._ragdollRenderedCount = 0;
      this._ragdollCubeIndex = 0; this._ragdollHeadIndex = 0;
      if (world && world.bodies.size) {
        this._makeRagdollInstances();
        for (const body of world.bodies.values()) {
          if (this._ragdollRenderedCount >= 24) break;
          const model = body.id === 'player' ? this._player : this._residents.get(body.id);
          if (!model) continue;
          this._ragdollPose(body, model); this._ragdollRenderedCount++;
        }
      }
      if (this._ragdollCubes) for (const [mesh, count] of [[this._ragdollCubes, this._ragdollCubeIndex], [this._ragdollHeads, this._ragdollHeadIndex]]) {
        mesh.count = count; mesh.visible = count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }

    // Slab intersection includes a small margin for the camera's near plane.
    _boomFraction(x, y, z, endX, endY, endZ) {
      let nearest = this._terrainBoomFraction(x, y, z, endX, endY, endZ);
      const dx = endX - x, dy = endY - y, dz = endZ - z, margin = 0.22;
      for (const box of this._buildingVolumes) {
        if (box.object?.destroyed) continue;
        const cx = box.cx ?? (box.minX + box.maxX) / 2, cz = box.cz ?? (box.minZ + box.maxZ) / 2;
        const cosine = box.cosine ?? 1, sine = box.sine ?? 0;
        const halfX = box.halfX ?? (box.maxX - box.minX) / 2, halfZ = box.halfZ ?? (box.maxZ - box.minZ) / 2;
        let near = 0, far = 1;
        const values = [
          [(x - cx) * cosine + (z - cz) * sine, dx * cosine + dz * sine, -halfX - margin, halfX + margin],
          [y, dy, box.minY, box.maxY + margin],
          [-(x - cx) * sine + (z - cz) * cosine, -dx * sine + dz * cosine, -halfZ - margin, halfZ + margin]
        ];
        let intersects = true;
        for (const v of values) {
          if (Math.abs(v[1]) < 0.000001) { if (v[0] < v[2] || v[0] > v[3]) { intersects = false; break; } }
          else {
            let first = (v[2] - v[0]) / v[1], second = (v[3] - v[0]) / v[1];
            if (first > second) { const swap = first; first = second; second = swap; }
            near = Math.max(near, first); far = Math.min(far, second);
            if (near > far) { intersects = false; break; }
          }
        }
        if (intersects && far > 0 && near < nearest) nearest = Math.max(0, near);
      }
      return nearest;
    }

    _terrainBoomFraction(x, y, z, endX, endY, endZ) {
      if (!this.game.world?.terrain) return 1;
      const dx = endX - x, dy = endY - y, dz = endZ - z;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / .20)), clearance = .22;
      const blocked = at => {
        const px=mix(x,endX,at),pz=mix(z,endZ,at),py=mix(y,endY,at);
        const floor=this._surfaceY(px,pz,y),deck=this._surfaceY(px,pz);
        // Below a bridge the boom can reach the underside, while above it
        // the deck remains the floor. Keep the near plane clear on both sides.
        return py<floor+clearance || deck>floor+.2 && py>deck-.32-clearance;
      };
      if (blocked(0)) return 0;
      for (let i = 1; i <= steps; i++) if (blocked(i / steps)) {
        let low = (i - 1) / steps, high = i / steps;
        for (let refine = 0; refine < 9; refine++) {
          const middle = (low + high) / 2;
          if (blocked(middle)) high = middle; else low = middle;
        }
        return low;
      }
      return 1;
    }

    _insideBuilding(x, y, z) {
      return this._buildingVolumes.some(box => {
        if (box.object?.destroyed) return false;
        const cx = box.cx ?? (box.minX + box.maxX) / 2, cz = box.cz ?? (box.minZ + box.maxZ) / 2;
        const cosine = box.cosine ?? 1, sine = box.sine ?? 0;
        const halfX = box.halfX ?? (box.maxX - box.minX) / 2, halfZ = box.halfZ ?? (box.maxZ - box.minZ) / 2;
        const localX = (x - cx) * cosine + (z - cz) * sine, localZ = -(x - cx) * sine + (z - cz) * cosine;
        return Math.abs(localX) < halfX + .17 && Math.abs(localZ) < halfZ + .17 && y < box.maxY + .17 && y > box.minY;
      });
    }

    _cameraStep(dt) {
      const current = this.game.current, driving = Boolean(this.game.player.vehicleId);
      const flying = driving && (current.kind === 'aircraft' || Boolean(current.aircraftType));
      const workshop = this.game.services?.find(service => service.id === 'repair');
      const workshopX = workshop ? (current.x - workshop.x) * Math.cos(workshop.angle) + (current.y - workshop.y) * Math.sin(workshop.angle) : Infinity;
      const workshopZ = workshop ? -(current.x - workshop.x) * Math.sin(workshop.angle) + (current.y - workshop.y) * Math.cos(workshop.angle) : Infinity;
      const inWorkshop = driving && !flying && Math.abs(workshopX) < 100 && workshopZ > -160 && workshopZ < 110 && Math.abs(current.elevation - workshop.elevation) < 1;
      const fallen = !driving && this._bodyFor(this.game.player);
      let x = current.x / UNIT, z = current.y / UNIT;
      const elevation = Number.isFinite(current.elevation) ? current.elevation : this._surfaceY(x, z);
      // A roof landing needs the pivot above the roof's near-plane envelope.
      let targetHeight = fallen ? Math.max(0.55, (fallen.joints.pelvis.y + fallen.joints.chest.y) / 2 + 0.15) : elevation + (flying ? 1.8 : driving ? 1.15 : FOOT_PIVOT);
      targetHeight = Math.max(targetHeight, this._surfaceY(x, z, elevation) + .48);
      if (fallen) {
        // A physical pelvis is smaller than the camera clearance envelope.
        // Move the look-at pivot out of that envelope before solving the boom,
        // including bodies resting on roofs, to avoid a zero-length camera.
        const margin = 0.27;
        for (const box of this._buildingVolumes) {
          if (box.object?.destroyed) continue;
          const cx = box.cx ?? (box.minX + box.maxX) / 2, cz = box.cz ?? (box.minZ + box.maxZ) / 2;
          const cosine = box.cosine ?? 1, sine = box.sine ?? 0;
          const halfX = box.halfX ?? (box.maxX - box.minX) / 2, halfZ = box.halfZ ?? (box.maxZ - box.minZ) / 2;
          let localX = (x - cx) * cosine + (z - cz) * sine, localZ = -(x - cx) * sine + (z - cz) * cosine;
          if (Math.abs(localX) >= halfX + margin || Math.abs(localZ) >= halfZ + margin || targetHeight >= box.maxY + margin) continue;
          const exits = [
            { distance: localX + halfX + margin, x: -halfX - margin },
            { distance: halfX + margin - localX, x: halfX + margin },
            { distance: localZ + halfZ + margin, z: -halfZ - margin },
            { distance: halfZ + margin - localZ, z: halfZ + margin },
            { distance: box.maxY + margin - targetHeight, y: box.maxY + margin }
          ];
          let exit = exits[0];
          for (let i = 1; i < exits.length; i++) if (exits[i].distance < exit.distance) exit = exits[i];
          localX = exit.x ?? localX; localZ = exit.z ?? localZ;
          x = cx + localX * cosine - localZ * sine; z = cz + localX * sine + localZ * cosine;
          targetHeight = exit.y ?? targetHeight;
        }
      }
      // A shoulder exit can move the pivot uphill. Keep its new position above
      // that slope before solving a boom from the relocated fallen body.
      targetHeight = Math.max(targetHeight, this._surfaceY(x, z, elevation) + .48);
      const mode = flying ? 'flight' : driving ? 'drive' : 'foot';
      if (this._lastVehicleId !== this.game.player.vehicleId) {
        if (driving) this._driveOffset = angle(this._yaw - current.angle);
        else this._requestedYaw = this._yaw;
        this._lastVehicleId = this.game.player.vehicleId;
        this._orbitTimer = 0.45;
      }
      this._orbitTimer = Math.max(0, this._orbitTimer - dt);
      if (driving && current.kind !== 'tank' && this._orbitTimer === 0) {
        this._driveOffset = angle(this._driveOffset * Math.exp(-dt * 1.9));
        this._pitch = DEFAULT_PITCH + (this._pitch - DEFAULT_PITCH) * Math.exp(-dt * 1.1);
      }
      const desiredYaw = driving ? angle(current.angle + this._driveOffset) : this._requestedYaw;
      const follow = this._hasCamera ? 1 - Math.exp(-dt * (driving ? 6.0 : 13.0)) : 1;
      this._yaw = angle(this._yaw + angle(desiredYaw - this._yaw) * follow);
      this._viewPitch = mix(this._viewPitch, this._pitch, follow);
      const aiming = this._aiming && !driving && !fallen;
      this._aimBlend = mix(this._aimBlend, aiming ? 1 : 0, this._hasCamera ? 1 - Math.exp(-dt * 12) : 1);
      const speed = driving ? Math.abs(current.speed || 0) / UNIT : 0;
      const aircraftModel = flying && this._aircraft?.get(current.id);
      const flightBoom = clamp((aircraftModel?.length || 8) * .8 + (aircraftModel?.width || 9) * .6, 14, 26);
      const distance = inWorkshop ? 4.8 : flying ? flightBoom + Math.min(6, speed * .08) : driving ? 7.4 + Math.min(1.8, speed * 0.06) : mix(5.5, 2.9, this._aimBlend);
      const horizontal = Math.cos(this._viewPitch) * distance;
      const shoulder = driving ? 0 : 0.70 * this._aimBlend;
      const clearance = inWorkshop ? .35 : flying ? 3 : driving ? 1.5 : mix(1.05, 0.50, this._aimBlend);
      const lift = -Math.sin(this._viewPitch) * distance + clearance;
      const targetY = targetHeight;
      this._cameraTarget.set(x, targetY, z);
      let cameraYaw = this._yaw;
      const endAt = yaw => ({
        x: x - Math.cos(yaw) * horizontal - Math.sin(yaw) * shoulder,
        z: z - Math.sin(yaw) * horizontal + Math.cos(yaw) * shoulder
      });
      let end = endAt(cameraYaw);
      let endX = end.x, endY = Math.max(0.45, targetY + lift), endZ = end.z;
      let fraction = this._boomFraction(x, targetY, z, endX, endY, endZ);
      // When backed against a wall, slide to a nearby safe shoulder instead of
      // putting the player's head directly against the camera lens.
      if (fraction < 0.33) {
        let bestFraction = fraction, bestYaw = cameraYaw;
        const shoulders = fallen ? [0.48, -0.48, 0.96, -0.96, 1.40, -1.40, 2.2, -2.2, Math.PI] : [0.48, -0.48, 0.96, -0.96, 1.40, -1.40];
        for (const offset of shoulders) {
          const testYaw = angle(this._yaw + offset);
          end = endAt(testYaw);
          const testFraction = this._boomFraction(x, targetY, z, end.x, endY, end.z);
          if (testFraction > bestFraction) { bestFraction = testFraction; bestYaw = testYaw; }
          if (testFraction > 0.80) break;
        }
        cameraYaw = bestYaw; fraction = bestFraction;
        end = endAt(cameraYaw); endX = end.x; endZ = end.z;
      }
      const obstructed = fraction < 0.995;
      const safeFraction = obstructed ? Math.max(0, fraction - 0.045) : 1;
      this._desiredCamera.set(mix(x, endX, safeFraction), mix(targetY, endY, safeFraction), mix(z, endZ, safeFraction));
      const snap = !this._hasCamera || Math.hypot(this.camera.position.x - x, this.camera.position.z - z) > Math.max(18, distance * 2);
      if (snap) this.camera.position.copy(this._desiredCamera);
      else {
        const smoothing = 1 - Math.exp(-dt * (obstructed ? 18 : 9));
        this.camera.position.lerp(this._desiredCamera, smoothing);
        if (!obstructed) {
          // Cartesian orbit smoothing cuts across the orbit's circle, pulling
          // the view toward the player during a fast turn. Smooth boom length
          // separately, then retain the existing collision sweep below.
          const desiredLength = this._desiredCamera.distanceTo(this._cameraTarget);
          const length = mix(this._cameraInfo.distance ?? desiredLength, desiredLength, smoothing);
          const offset = this._cameraBoomOffset ??= new this.T.Vector3();
          offset.copy(this.camera.position).sub(this._cameraTarget);
          if (offset.lengthSq() > .000001) this.camera.position.copy(this._cameraTarget).add(offset.setLength(length));
          else this.camera.position.copy(this._desiredCamera);
        }
      }
      // Position interpolation can cut a corner. Recheck the interpolated boom
      // and clamp it immediately, so no frame renders from inside a building.
      const actualFraction = this._boomFraction(x, targetY, z, this.camera.position.x, this.camera.position.y, this.camera.position.z);
      if (actualFraction < 1) {
        const factor = Math.max(0, actualFraction - 0.04);
        this.camera.position.set(mix(x, this.camera.position.x, factor), mix(targetY, this.camera.position.y, factor), mix(z, this.camera.position.z, factor));
      }
      // A large recovery jump or a tight corner can put the old camera across a
      // wall from the new pivot. Prefer the already-tested shoulder position to
      // a nearly zero-length interpolated boom in that case.
      const minimumBoom = driving ? 1.6 : 1.2;
      if (this.camera.position.distanceToSquared(this._cameraTarget) < minimumBoom * minimumBoom && this._desiredCamera.distanceToSquared(this._cameraTarget) > minimumBoom * minimumBoom) {
        this.camera.position.copy(this._desiredCamera);
      }
      this.camera.position.y = Math.max(this._surfaceY(this.camera.position.x, this.camera.position.z, elevation) + .23, this.camera.position.y);
      // Looking is independent of the physical boom pivot. Locking lookAt to
      // the character makes the centre crosshair point at the player's back.
      // The view instead faces ahead, including when walls shorten the boom.
      this._viewDirection.set(Math.cos(this._yaw) * Math.cos(this._viewPitch), Math.sin(this._viewPitch), Math.sin(this._yaw) * Math.cos(this._viewPitch));
      this._lookTarget.copy(this.camera.position).add(this._viewDirection);
      this.camera.lookAt(this._lookTarget);
      const fov = flying ? 64 + Math.min(5, speed * .035) : mix(57, 48, this._aimBlend);
      if (Math.abs(this.camera.fov - fov) > 0.0001) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
      this.camera.updateMatrixWorld(true);
      this._hasCamera = true;
      this._cameraMode = mode;
      this.camera.getWorldDirection(this._viewDirection);
      const actualYaw = Math.atan2(this._viewDirection.z, this._viewDirection.x);
      this._cameraInfo.x = this.camera.position.x;
      this._cameraInfo.y = this.camera.position.y;
      this._cameraInfo.z = this.camera.position.z;
      this._cameraInfo.targetX = x;
      this._cameraInfo.targetY = targetY;
      this._cameraInfo.targetZ = z;
      this._cameraInfo.mode = mode;
      this._cameraInfo.distance = this.camera.position.distanceTo(this._cameraTarget);
      this._cameraInfo.obstructed = obstructed || actualFraction < 0.995;
      this._cameraInfo.viewYaw = actualYaw;
      this._cameraInfo.viewPitch = Math.atan2(this._viewDirection.y, Math.hypot(this._viewDirection.x, this._viewDirection.z));
      this._cameraInfo.aiming = Boolean(aiming);
      this._cameraInfo.fov = this.camera.fov;
      // Sun follows a snapped grid so shadows stay stable as the town scrolls.
      const shadowX = Math.round(x / 5) * 5, shadowZ = Math.round(z / 5) * 5;
      const shadowHeight = flying ? elevation : 0;
      this._sun.position.set(shadowX - 22, shadowHeight + 48, shadowZ - 30);
      this._sun.target.position.set(shadowX, shadowHeight, shadowZ);
    }

    _syncResidents() {
      const active=new Set();
      for(const ped of this.game.peds){
        active.add(ped.id);if(this._residents.has(ped.id))continue;
        const model=(ped.soldier&&root.MayhemTroopRender?.createSoldier(this,ped))||this._person(ped.color,false);
        model.bubble=this._bubble();model.group.add(model.bubble.sprite);
        this._residents.set(ped.id,model);this.scene.add(model.group);
      }
      for(const [id,model]of this._residents)if(!active.has(id)){
        const bubble=model.bubble;
        bubble.sprite.removeFromParent();bubble.texture.dispose();bubble.sprite.material.dispose();
        this._textures=this._textures.filter(texture=>texture!==bubble.texture);this._materials.delete(bubble.materialKey);
        if(model.soldier)root.MayhemTroopRender?.retireSoldier(this,id,model);
        model.group.removeFromParent();this._residents.delete(id);
      }
    }

    _people(dt) {
      const game = this.game, player = game.player, model = this._player;
      const playerBody = this._bodyFor(player);
      model.group.visible = !player.vehicleId && !playerBody;
      model.group.position.set(player.x / UNIT, (Number.isFinite(player.elevation) ? player.elevation : 0) + 0.03, player.y / UNIT);
      model.group.rotation.y = -player.angle;
      const movement = Math.hypot(player.x - this._lastPlayerX, player.y - this._lastPlayerY) / UNIT;
      this._lastPlayerX = player.x; this._lastPlayerY = player.y;
      this._walkPhase += Math.min(0.7, movement * 1.9);
      const stride = !player.trainRide && !this.reducedMotion && movement > 0.002 ? Math.sin(this._walkPhase) * 0.65 : 0;
      model.leftLeg.rotation.z = stride; model.rightLeg.rotation.z = -stride;
      model.leftArm.rotation.z = -stride * 0.65; model.rightArm.rotation.z = stride * 0.65;
      const equipped = model.toys[game.inventory?.equipped] ? game.inventory.equipped : 'popper';
      if (model.equipped !== equipped) {
        for (const [id, toy] of Object.entries(model.toys)) toy.visible = id === equipped;
        model.equipped = equipped;
      }
      const cooldown = Math.max(0, game._actionCooldown || 0);
      model.rightArm.rotation.y = 0;
      if (equipped === 'hammer' && cooldown > 0) {
        const elapsed = 0.9 - cooldown;
        model.rightArm.rotation.z = this.reducedMotion ? Math.PI / 2
          : elapsed < 0.55 ? mix(2.7, 1.1, clamp(elapsed / 0.55, 0, 1)) : mix(1.1, 0, clamp((elapsed - 0.55) / 0.35, 0, 1));
      } else if (this._cameraInfo.aiming || cooldown > (equipped === 'cannon' ? 0.86 : 0.35)) {
        const pitch = Number.isFinite(player.aimPitch) ? clamp(player.aimPitch, -1.35, 1.35) : 0;
        model.rightArm.rotation.z = Math.PI / 2 + pitch;
        model.rightArm.rotation.y = -0.1;
      }
      for (const [id, toy] of Object.entries(model.toys)) toy.visible = !player.parachuting && !player.trainRide && id === equipped;
      if (player.trainRide) {
        model.leftLeg.rotation.z = .25; model.rightLeg.rotation.z = -.15;
        model.leftArm.rotation.z = 2.05; model.rightArm.rotation.z = 2.05;
        model.rightArm.rotation.y = 0;
      }
      if (player.parachuting) {
        model.leftLeg.rotation.z = .12; model.rightLeg.rotation.z = -.12;
        model.leftArm.rotation.z = 2.4; model.rightArm.rotation.z = 2.4;
        model.rightArm.rotation.y = 0;
      }
      for (const ped of game.peds) {
        const resident = this._residents.get(ped.id);
        if (!resident) continue;
        const body = this._bodyFor(ped);
        resident.group.visible = !body;
        resident.group.position.set(ped.x / UNIT, (Number.isFinite(ped.elevation) ? ped.elevation : 0) + 0.03, ped.y / UNIT);
        resident.group.rotation.y = -ped.angle;
        const walk = !ped.soldier && !this.reducedMotion && ped.stunned <= 0 ? Math.sin(game.time * ped.pace / UNIT * 5 + Number(ped.id.split('-')[1])) * 0.30 : 0;
        resident.leftLeg.rotation.z = walk; resident.rightLeg.rotation.z = -walk;
        resident.leftArm.rotation.z = -walk * 0.8; resident.rightArm.rotation.z = walk * 0.8;
        resident.group.rotation.z = 0;
        const bubble = resident.bubble.sprite;
        if (body) {
          if (bubble.parent !== this.scene) { this.scene.add(bubble); bubble.scale.set(3.2 * CHARACTER_SCALE, 0.8 * CHARACTER_SCALE, 1); }
          bubble.position.set(body.joints.pelvis.x, Math.max(body.joints.head.y, body.joints.pelvis.y) + 0.95 * CHARACTER_SCALE, body.joints.pelvis.z);
        } else {
          if (bubble.parent !== resident.group) { resident.group.add(bubble); bubble.scale.set(3.2, 0.8, 1); }
          bubble.position.set(0, 2.27, 0);
        }
        this._bubbleText(resident.bubble, !ped.transportedBy&&ped.bubbleTimer > 0 ? ped.bubble : '');
      }
      this._ragdollPeople();
      this._parachuteStep();
    }

    _parachuteStep() {
      const player = this.game.player;
      if (player.parachuting && !this._parachute) {
        const T = this.T, group = new T.Group(); group.name = 'Player parachute';
        const geometry = this._geometry(new T.SphereGeometry(1, 16, 5, 0, TAU, 0, Math.PI / 2));
        const positions = geometry.attributes.position, colors = new Float32Array(positions.count * 3), color = new T.Color();
        for (let i = 0; i < positions.count; i++) {
          const panel = Math.floor((Math.atan2(positions.getZ(i), positions.getX(i)) + Math.PI) * 4 / Math.PI);
          color.set(panel % 2 ? '#f4d35c' : '#ee805f'); colors.set([color.r, color.g, color.b], i * 3);
        }
        geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
        const material = new T.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true, side: T.DoubleSide });
        this._materials.set('parachute-canopy', material);
        this._mesh(geometry, material, group, 0, 3.6, 0, 2.7, 1.1, 2.2, true);
        const up = new T.Vector3(0, 1, 0), bottom = new T.Vector3(), top = new T.Vector3(), direction = new T.Vector3();
        for (const front of [-1, 1]) for (const side of [-1, 1]) {
          bottom.set(front * .18, 1.32, side * .29); top.set(front * 1.9, 3.6, side * 1.55);
          direction.copy(top).sub(bottom);
          const rope = this._mesh(this._cylinder, this._material('#f7eed5'), group, 0, 0, 0, .014, direction.length(), .014, false);
          rope.position.copy(top).add(bottom).multiplyScalar(.5); rope.quaternion.setFromUnitVectors(up, direction.normalize());
        }
        this.scene.add(group); this._parachute = group;
      }
      if (this._parachute) {
        this._parachute.visible = Boolean(player.parachuting && !player.vehicleId);
        this._parachute.position.set(player.x / UNIT, player.elevation || 0, player.y / UNIT);
        this._parachute.rotation.set(0, -(player.angle || 0), this.reducedMotion ? 0 : Math.sin((this.game.time || 0) * 1.7) * .025);
      }
    }

    _cars(dt) {
      const active = new Set();
      for (const entity of this.game.cars.concat(this.game.police)) {
        active.add(entity.id);
        let model = this._vehicles.get(entity.id);
        if (!model) { model = this._vehicle(entity, entity.id.startsWith('police-')); this._vehicles.set(entity.id, model); }
        model.group.position.set(entity.x / UNIT, (Number.isFinite(entity.elevation) ? entity.elevation : 0) + model.centerHeight, entity.y / UNIT);
        const orientation = entity.orientation;
        const fullOrientation = orientation && ['x', 'y', 'z', 'w'].every(key => Number.isFinite(orientation[key]));
        if (fullOrientation) model.group.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w).normalize();
        else model.group.rotation.set(0, -entity.angle, 0);
        model.group.visible = true;
        model.roll = angle(model.roll + (entity.speed || 0) / UNIT / 0.31 * dt);
        const wheelDamage = 1 - clamp((Number.isFinite(entity.handlingHealth) ? entity.handlingHealth : 100) / 100, 0, 1);
        for (let i = 0; i < model.wheels.length; i++) {
          model.wheels[i].rotation.z = model.roll;
          model.wheels[i].rotation.y = wheelDamage * (i % 2 ? -0.14 : 0.09);
        }
        if (model.police) {
          const flashing = this.game.heat > 0 && !this.reducedMotion;
          const redOn = !flashing || Math.sin(this.game.time * 13) > 0;
          model.red.scale.y = redOn ? 0.13 : 0.075;
          model.blue.scale.y = redOn ? 0.075 : 0.13;
        } else {
          this._paintVehicle(model, entity.color);
        }
        this._damageVehicle(model, entity);
        this._vehicleEffects(model, entity);
      }
      for (const [id, model] of this._vehicles) if (!active.has(id)) this._retireVehicle(id, model);
    }

    _projectileEffects() {
      if (!this._toyShots) {
        this._toyShots = new this.T.InstancedMesh(this._sphere, this._material('#ffffff', { unlit: true }), 96);
        this._toyShots.instanceMatrix.setUsage(this.T.DynamicDrawUsage);
        this._toyShots.frustumCulled = false;
        this.scene.add(this._toyShots);
      }
      const shots = (this.game.projectiles || []).slice(0, 32).concat((this.game.aircraftProjectiles || []).slice(0, 64));
      let count = 0;
      for (const shot of shots) {
        if (count === 96) break;
        const height = shot.height ?? shot.elevation;
        const heading = Number.isFinite(shot.angle) ? shot.angle : Math.atan2(shot.vy || 0, shot.vx || 0);
        if (shot.life <= 0 || !Number.isFinite(shot.x + shot.y + height + heading)) continue;
        this._dummy.position.set(shot.x / UNIT, height, shot.y / UNIT);
        const explosive = shot.weapon === 'missile' || shot.weapon === 'rocket';
        const aerial = Boolean(shot.ownerId);
        this._dummy.rotation.set(aerial ? 0 : this.game.time * 8, -heading, explosive ? Math.atan2(shot.vz || 0, Math.hypot(shot.vx || 0, shot.vy || 0) / UNIT) : aerial ? 0 : this.game.time * 5);
        this._dummy.scale.set(explosive ? .85 : aerial ? .30 : .19, explosive ? .17 : aerial ? .16 : .19, explosive ? .17 : aerial ? .16 : .19);
        this._dummy.updateMatrix();
        this._toyShots.setMatrixAt(count, this._dummy.matrix);
        let hue = 0;
        for (const letter of String(shot.id)) hue = (hue + letter.charCodeAt(0)) % palette.length;
        this._color.set(shot.color || palette[hue]); this._toyShots.setColorAt(count, this._color);
        count++;
      }
      this._toyShots.count = count;
      this._toyShots.visible = count > 0;
      this._toyShots.instanceMatrix.needsUpdate = true;
      if (this._toyShots.instanceColor) this._toyShots.instanceColor.needsUpdate = true;
    }

    _debrisEffects() {
      const debris = this.game.debris || [];
      if (!this._debris && debris.length) {
        this._debris = new this.T.InstancedMesh(this._cube, this._material('#ffffff'), 120);
        this._debris.instanceMatrix.setUsage(this.T.DynamicDrawUsage);
        this._debris.frustumCulled = false;
        this._debris.castShadow = true; this._debris.receiveShadow = true;
        this.scene.add(this._debris);
      }
      let count = 0;
      for (const piece of debris) {
        if (count === 120) break;
        const size = piece.size;
        if (piece.life <= 0 || !size || size.length !== 3 || !size.every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(piece.x + piece.y + piece.elevation + piece.angle + piece.spin)) continue;
        const age = Math.max(0, (piece.maxLife || piece.life) - piece.life);
        const fade = clamp(piece.life / .45, 0, 1);
        this._dummy.position.set(piece.x / UNIT, piece.elevation, piece.y / UNIT);
        this._dummy.rotation.set(age * piece.spin, -piece.angle, age * piece.spin * .7);
        this._dummy.scale.set(size[0] * fade, size[1] * fade, size[2] * fade);
        this._dummy.updateMatrix();
        this._debris.setMatrixAt(count, this._dummy.matrix);
        this._color.set(piece.color || '#c6af8b'); this._debris.setColorAt(count, this._color);
        count++;
      }
      if (this._debris) {
        this._debris.count = count; this._debris.visible = count > 0;
        this._debris.instanceMatrix.needsUpdate = true;
        if (this._debris.instanceColor) this._debris.instanceColor.needsUpdate = true;
      }
      if (this.canvas?.dataset) this.canvas.dataset.debrisCount = String(count);
    }

    _effects() {
      const game = this.game;
      this._projectileEffects();
      this._debrisEffects();
      this._confetti.count = Math.min(360, game.particles.length);
      for (let i = 0; i < this._confetti.count; i++) {
        const particle = game.particles[i], age = particle.maxLife - particle.life;
        const rise = Math.sin(clamp(age / particle.maxLife, 0, 1) * Math.PI) * 1.75;
        this._dummy.position.set(particle.x / UNIT, (Number.isFinite(particle.height) ? particle.height : this._surfaceY(particle.x / UNIT, particle.y / UNIT) + .20) + rise, particle.y / UNIT);
        this._dummy.rotation.set(age * 5 + i, age * 3, age * 7 + i * 0.7);
        const size = particle.size / UNIT;
        this._dummy.scale.set(size, size * 0.22, size * 0.72);
        this._dummy.updateMatrix();
        this._confetti.setMatrixAt(i, this._dummy.matrix);
        this._color.set(particle.color); this._confetti.setColorAt(i, this._color);
      }
      this._confetti.instanceMatrix.needsUpdate = true;
      if (this._confetti.instanceColor) this._confetti.instanceColor.needsUpdate = true;
      this._skids.count = Math.min(250, game.skidMarks.length);
      for (let i = 0; i < this._skids.count; i++) {
        const mark = game.skidMarks[i];
        this._dummy.position.set(mark.x / UNIT, this._surfaceY(mark.x / UNIT, mark.y / UNIT) + .056, mark.y / UNIT);
        this._surfaceQuaternion(mark.x / UNIT, mark.y / UNIT, mark.angle, this._dummy.quaternion);
        this._dummy.scale.set(0.55, 0.008, 0.85);
        this._dummy.updateMatrix(); this._skids.setMatrixAt(i, this._dummy.matrix);
      }
      this._skids.instanceMatrix.needsUpdate = true;
      const mission = game.mission, target = mission && mission.targets[mission.targetIndex];
      this._target.visible = Boolean(target);
      if (target) {
        this._target.position.set(target.x / UNIT, target.elevation ?? this._surfaceY(target.x / UNIT, target.y / UNIT), target.y / UNIT);
        if (target.aerial) {
          this._targetRing.rotation.set(0, -(target.angle ?? game.current.angle) + Math.PI / 2, 0);
        } else {
          this._surfaceQuaternion(target.x / UNIT, target.y / UNIT, 0, this._targetRing.quaternion);
          this._targetRing.rotateX(-Math.PI / 2);
        }
        const pulse = this.reducedMotion ? 1 : 1 + Math.sin(game.time * 3) * 0.045;
        this._targetRing.scale.setScalar(pulse * (target.aerial ? 2.5 : 1));
        this._targetBeam.visible = !target.aerial;
        this._targetDiamond.rotation.y = this.reducedMotion ? 0 : game.time;
        this._targetDiamond.position.y = 3.4 + (this.reducedMotion ? 0 : Math.sin(game.time * 2.8) * 0.15);
      }
    }

    update(dt, options = {}) {
      const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
      if (options.reducedMotion !== undefined) this.reducedMotion = Boolean(options.reducedMotion);
      this._syncDestructibleProps();
      this._syncResidents();
      this._people(step);
      this._cars(options.paused ? 0 : step);
      this._aircraftStep(options.paused ? 0 : step);
      root.MayhemTrainRender?.step(this);
      root.MayhemMilitaryRender?.step?.(this);
      root.MayhemTankRender?.step?.(this);
      root.MayhemTroopRender?.step?.(this);
      this._effects();
      this._landscapeStep(this.game.time);
      this._cameraStep(step);
      this.renderer.render(this.scene, this.camera);
    }

    dispose() {
      root.MayhemTroopRender?.dispose?.(this);
      this._ragdollCubes?.dispose();
      this._ragdollHeads?.dispose();
      this._toyShots?.dispose();
      this._debris?.dispose();
      for (const mesh of this._propInstances || []) mesh.dispose();
      this._riverFlow?.dispose();
      this._bridgeUndersides?.dispose();
      this._bridgePiers?.dispose();
      for (const model of this._vehicles.values()) { model.effects.flames.dispose(); model.effects.smoke.dispose(); }
      for (const [id, model] of this._aircraft || []) this._retireAircraft(id, model);
      for (const geometry of this._geometries) geometry.dispose();
      for (const material of this._materials.values()) material.dispose();
      for (const texture of this._textures) texture.dispose();
      this.renderer.dispose();
    }
  }

  root.MayhemScene = Scene3D;
})(globalThis);
