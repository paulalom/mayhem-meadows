/* Mayhem Meadows: a self-contained, low-poly third-person toy town. */
(function (root) {
  'use strict';
  const UNIT = 20, TAU = Math.PI * 2, DEFAULT_PITCH = -0.24;
  const CHARACTER_SCALE = root.MayhemPhysics?.CHARACTER_SCALE ?? 0.86;
  const MUZZLE_HEIGHT = root.MayhemPhysics?.MUZZLE_HEIGHT ?? 1.15 * CHARACTER_SCALE;
  const FOOT_PIVOT = 1.03 * CHARACTER_SCALE;
  const SIDEWALK_WIDTH = 1.52;
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
      this.scene.fog = new T.Fog('#c4dce5', 65, 205);
      this.camera = new T.PerspectiveCamera(57, 1, 0.06, 275);
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
      this._dummy = new T.Object3D();
      this._color = new T.Color();
      this._staticParts = new Map();
      this._materials = new Map();
      this._geometries = [];
      this._textures = [];
      this._buildingVolumes = [];
      this._propVolumes = [];
      this._propAimMeshes = [];
      this._vehicles = new Map();
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
      this._player = this._person('#7b64df', true);
      this.scene.add(this._player.group);
      for (const resident of game.peds) {
        const model = this._person(resident.color, false);
        const bubble = this._bubble();
        model.group.add(bubble.sprite);
        model.bubble = bubble;
        this._residents.set(resident.id, model);
        this.scene.add(model.group);
      }
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
      const key = material.uuid + ':' + shadow;
      if (!this._staticParts.has(key)) this._staticParts.set(key, { material, shadow, parts: [] });
      this._staticParts.get(key).parts.push({ geometry, matrix: object.matrix.clone() });
    }

    _staticBox(color, x, y, z, sx, sy, sz, shadow = true) {
      this._static(this._cube, typeof color === 'string' ? this._material(color) : color, x, y, z, sx, sy, sz, null, shadow);
    }

    // The decorative town is merged by material, keeping hundreds of windows and
    // road markings inexpensive without requiring an extra geometry library.
    _bakeStatics() {
      const T = this.T;
      const vector = new T.Vector3(), normal = new T.Vector3(), normalMatrix = new T.Matrix3();
      for (const batch of this._staticParts.values()) {
        let vertices = 0, indices = 0;
        for (const part of batch.parts) { vertices += part.geometry.attributes.position.count; indices += part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count; }
        const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3);
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
          }
          const sourceIndex = part.geometry.index;
          const count = sourceIndex ? sourceIndex.count : p.count;
          for (let i = 0; i < count; i++) index[indexOffset++] = vertexOffset + (sourceIndex ? sourceIndex.getX(i) : i);
          vertexOffset += p.count;
        }
        const geometry = this._geometry(new T.BufferGeometry());
        geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
        geometry.setIndex(new T.BufferAttribute(index, 1));
        geometry.computeBoundingSphere();
        const mesh = new T.Mesh(geometry, batch.material);
        mesh.castShadow = batch.shadow;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
      this._staticParts.clear();
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
      const T = this.T, core = root.MayhemCore;
      const size = core.SIZE / UNIT, centers = core.ROAD_CENTERS.map(v => v / UNIT), roadWidth = core.ROAD_WIDTH / UNIT;
      this._staticBox('#a7c991', size / 2, -0.15, size / 2, size + 6, 0.3, size + 6, false);
      const asphalt = this._material('#627789'), curb = this._material('#e9e5d6'), sidewalk = this._material('#d4d7cc');
      const sidewalkGaps = [];
      let gapStart = 0;
      for (const center of centers) {
        sidewalkGaps.push([gapStart, center - roadWidth / 2 - 0.1]);
        gapStart = center + roadWidth / 2 + 0.1;
      }
      sidewalkGaps.push([gapStart, size]);
      for (const center of centers) {
        this._staticBox(asphalt, center, 0.008, size / 2, roadWidth, 0.03, size + 3, false);
        this._staticBox(asphalt, size / 2, 0.011, center, size + 3, 0.03, roadWidth, false);
        for (const side of [-1, 1]) for (const gap of sidewalkGaps) {
          const along = (gap[0] + gap[1]) / 2, length = gap[1] - gap[0];
          this._staticBox(sidewalk, center + side * (roadWidth / 2 + SIDEWALK_WIDTH / 2 + 0.02), 0.065, along, SIDEWALK_WIDTH, 0.13, length, false);
          this._staticBox(sidewalk, along, 0.069, center + side * (roadWidth / 2 + SIDEWALK_WIDTH / 2 + 0.02), length, 0.13, SIDEWALK_WIDTH, false);
          this._staticBox(curb, center + side * (roadWidth / 2 + 0.02), 0.10, along, 0.09, 0.15, length, false);
          this._staticBox(curb, along, 0.104, center + side * (roadWidth / 2 + 0.02), length, 0.15, 0.09, false);
        }
        for (let along = 1; along < size; along += 2.2) {
          if (centers.some(v => Math.abs(v - along) < roadWidth / 2 + 0.4)) continue;
          this._staticBox('#f7e5a2', center, 0.035, along, 0.08, 0.012, 0.95, false);
          this._staticBox('#f7e5a2', along, 0.039, center, 0.95, 0.012, 0.08, false);
        }
      }
      // Crosswalks break up the street grid and make turns readable from a car.
      for (const x of centers) for (const z of centers) {
        for (let i = -2; i <= 2; i++) for (const side of [-1, 1]) {
          this._staticBox('#f3f0db', x + i * 0.64, 0.046, z + side * 3.10, 0.40, 0.015, 0.75, false);
          this._staticBox('#f3f0db', x + side * 3.10, 0.048, z + i * 0.64, 0.75, 0.015, 0.40, false);
        }
      }
      this._blockGrounds();
      for (let i = 0; i < this.game.buildings.length; i++) this._building(this.game.buildings[i], i);
      this._park();
      this._physicalProps();
      this._services();
      for (let i = 0; i < 26; i++) {
        const border = i % 4, at = 2 + Math.floor(i / 4) * 17;
        this._tree(border === 0 ? -5 : border === 1 ? size + 5 : at, border === 2 ? -5 : border === 3 ? size + 5 : at, 1.2, i);
      }
      this._landscape(size);
    }

    _blockGrounds() {
      for (const block of this.game.blocks || []) {
        const court = block.courtyard, paved = block.district === 'works' || block.district === 'market';
        if (court) this._staticBox(paved ? '#b5ada0' : '#acd29f', (court.x + court.w / 2) / UNIT, 0.028, (court.y + court.h / 2) / UNIT, court.w / UNIT, 0.035, court.h / UNIT, false);
        if (block.district === 'works' && court) for (let i = 0; i < 3; i++) {
          this._staticBox('#e6dbc0', (court.x + 18 + i * 27) / UNIT, 0.054, (court.y + court.h / 2) / UNIT, 0.055, 0.012, Math.min(2.8, court.h / UNIT), false);
        }
        if (this._worldInfo) this._worldInfo.districts[block.district] = (this._worldInfo.districts[block.district] || 0) + 1;
      }
      // A paved lookout follows the southern city edge; the distant river
      // stays beyond the playable boundary rather than cutting through roads.
      this._staticBox('#e6d7b8', 54, 0.035, 105.5, 102, 0.05, 1.2, false);
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
      const wallHeight = cottage ? Math.max(1.8, height - 1.0) : height - 0.18;
      const roofColor = cottage ? ['#8c746c', '#6a8583', '#ad7e72'][index % 3] : '#778b91';
      this._buildingVolumes.push({ minX: x - 0.12, maxX: x + w + 0.12, minZ: z - 0.12, maxZ: z + d + 0.12, minY: -.2, maxY: height + 0.45 });
      this._staticBox(building.color, cx, wallHeight / 2, cz, w, wallHeight, d);
      this._staticBox('#f1ead8', cx, 0.18, cz, w + .08, .36, d + .08);
      if (cottage) this._static(this._roofGeometry(), this._material(roofColor), cx, wallHeight, cz, w + .22, height - wallHeight, d + .22);
      else {
        this._staticBox('#ddd9cc', cx, height - .09, cz, w + .15, .20, d + .15);
        this._staticBox(roofColor, cx, height + .025, cz, Math.max(.2, w - .18), .045, Math.max(.2, d - .18));
      }
      const warehouse = style === 'warehouse', floors = cottage ? 1 : Math.max(1, Math.floor((wallHeight - .5) / (warehouse ? 2.2 : 1.8)));
      const alongX = Math.max(1, Math.floor(w / 1.6)), alongZ = Math.max(1, Math.floor(d / 1.6));
      for (let floor = 0; floor < floors; floor++) {
        const y = cottage ? 1.35 : 1.25 + floor * (warehouse ? 2.2 : 1.8);
        for (const side of [-1, 1]) {
          for (let column = 0; column < alongX; column++) {
            const px = x + (column + .5) * w / alongX;
            this._staticBox('#f3eddc', px, y, cz + side * (d / 2 + .02), Math.min(.9, w / alongX * .65), .88, .05, false);
            this._staticBox(warehouse ? '#708a91' : '#7396a3', px, y, cz + side * (d / 2 + .055), Math.min(.72, w / alongX * .5), .69, .025, false);
          }
          for (let column = 0; column < alongZ; column++) {
            const pz = z + (column + .5) * d / alongZ;
            this._staticBox('#f3eddc', cx + side * (w / 2 + .02), y, pz, .05, .88, Math.min(.9, d / alongZ * .65), false);
            this._staticBox(warehouse ? '#708a91' : '#7396a3', cx + side * (w / 2 + .055), y, pz, .025, .69, Math.min(.72, d / alongZ * .5), false);
          }
        }
      }
      if (warehouse) {
        for (let y = .5; y < wallHeight; y += .42) this._staticBox('#aa8475', x - .022, y, cz, .022, .018, d - .12, false);
        this._staticBox('#607481', x - .035, 1.1, cz, .05, 2.0, Math.min(2.6, d * .5), false);
        for (let y = .3; y < 2.1; y += .2) this._staticBox('#8d9fa4', x - .07, y, cz, .025, .025, Math.min(2.5, d * .48), false);
      } else this._staticBox('#426674', x - .04, .8, cz, .04, 1.5, Math.min(.75, d * .2), false);
      if (cottage) {
        this._staticBox('#ddcfb1', x - .4, .065, cz, .8, .065, Math.min(1.6, d * .6), false);
        this._staticBox('#f1dbb1', x - .14, 1.9, cz, .32, .1, Math.min(1.6, d * .6));
      } else {
        const frontage = Math.min(3.2, d * .86), awning = style === 'cafe' ? '#7ba89d' : '#e89988';
        this._staticBox(awning, x - .32, 2.05, cz, .65, .13, frontage);
        for (let i = 0; i < 6; i++) this._staticBox('#faedcf', x - .33, 2.125, cz - frontage / 2 + (i + .5) * frontage / 6, .67, .015, frontage / 12, false);
        this._sign(building.name, x - .11, Math.min(wallHeight - .35, 2.72), cz, -Math.PI / 2, '#fff4d6', '#425963', Math.min(3.5, d * .88), .55);
      }
      if (style === 'tower') {
        this._sign('12 : 00', x - .13, height - 1.15, cz, -Math.PI / 2, '#f1dfaf', '#51626a', Math.min(2.5, d * .8), .8);
        this._staticBox('#d6b276', cx, height + .18, cz, .12, .35, .12);
      }
    }

    _landscape(size) {
      const T = this.T, landscape = new T.Group(), river = new T.Group();
      landscape.name = 'Meadows hinterland';
      river.name = 'Winding river';
      this._landscapeGroup = landscape;
      this._riverGroup = river;
      this.scene.add(landscape, river);
      const curve = new T.CatmullRomCurve3([
        [-55, 133], [3, 125], [43, 130], [82, 120], [124, 130], [144, 98], [132, 54], [146, 8], [170, -38]
      ].map(([x, z]) => new T.Vector3(x, -0.34, z)));
      const samples = curve.getPoints(120);
      const riverDistance = (x, z) => Math.sqrt(Math.min(...samples.map(p => (x - p.x) ** 2 + (z - p.z) ** 2)));
      const terrainHeight = (x, z) => {
        const edge = Math.hypot(Math.max(0, -x, x - size), Math.max(0, -z, z - size));
        const rise = Math.min(1, edge / 24);
        let y = rise * rise * (3.2 + Math.sin(x / 17) * 2.7 + Math.cos(z / 21) * 2.1 + Math.sin((x + z) / 31) * 1.8);
        const distance = riverDistance(x, z);
        if (distance < 9) y = mix(-0.64, y, clamp((distance - 3.6) / 5.4, 0, 1));
        return y;
      };
      const positions = [], colors = [], indices = [], count = 51, start = -96, step = 6;
      for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
        const x = start + col * step, z = start + row * step, y = terrainHeight(x, z);
        positions.push(x, y, z);
        const color = new T.Color(y > 5 ? '#9fb59c' : '#a8c491');
        colors.push(color.r, color.g, color.b);
      }
      for (let row = 0; row < count - 1; row++) for (let col = 0; col < count - 1; col++) {
        const x = start + (col + 0.5) * step, z = start + (row + 0.5) * step;
        if (x >= 0 && x <= size && z >= 0 && z <= size) continue;
        const a = row * count + col;
        indices.push(a, a + count, a + 1, a + 1, a + count, a + count + 1);
      }
      const terrain = this._geometry(new T.BufferGeometry());
      terrain.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
      terrain.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      terrain.setIndex(indices);
      terrain.computeVertexNormals();
      const terrainMaterial = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      this._materials.set('terrain', terrainMaterial);
      const terrainMesh = new T.Mesh(terrain, terrainMaterial);
      terrainMesh.name = 'Rolling terrain';
      terrainMesh.receiveShadow = true;
      landscape.add(terrainMesh);
      const ribbon = (width, y, color, name) => {
        const points = [], faces = [];
        for (let i = 0; i < samples.length; i++) {
          const p = samples[i], tangent = curve.getTangent(i / (samples.length - 1)), nx = -tangent.z, nz = tangent.x;
          points.push(p.x + nx * width / 2, y, p.z + nz * width / 2, p.x - nx * width / 2, y, p.z - nz * width / 2);
          if (i < samples.length - 1) { const a = i * 2; faces.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        }
        const geometry = this._geometry(new T.BufferGeometry());
        geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
        geometry.setIndex(faces);
        geometry.computeVertexNormals();
        const mesh = new T.Mesh(geometry, this._material(color));
        mesh.name = name;
        mesh.receiveShadow = true;
        river.add(mesh);
        return mesh;
      };
      ribbon(9.6, -0.40, '#d9cba6', 'River bank');
      this._riverSurface = ribbon(7.1, -0.31, '#79bac7', 'River water');
      this._riverCurve = curve;
      this._riverFlow = new T.InstancedMesh(this._cube, this._material('#b8dde0', { unlit: true }), 18);
      this._riverFlow.name = 'Water glints';
      river.add(this._riverFlow);
      const bridgeAt = curve.getPoint(0.65), tangent = curve.getTangent(0.65), across = Math.atan2(tangent.x, -tangent.z);
      const bridge = this._box(landscape, '#b9a180', bridgeAt.x, 1.1, bridgeAt.z, 10.2, 0.18, 1.3);
      bridge.rotation.y = -across;
      for (const side of [-1, 1]) {
        const rail = this._box(landscape, '#ded2af', bridgeAt.x + Math.sin(across) * side * 0.58, 1.65, bridgeAt.z + Math.cos(across) * side * 0.58, 10.2, 0.08, 0.07);
        rail.rotation.y = -across;
      }
      let treeCount = 0;
      for (let i = 0; i < 64; i++) {
        const a = i / 64 * TAU, radius = 65 + (i % 5) * 8, x = size / 2 + Math.cos(a) * radius, z = size / 2 + Math.sin(a) * radius;
        if (x > -3 && x < size + 3 && z > -3 && z < size + 3 || riverDistance(x, z) < 7) continue;
        const y = terrainHeight(x, z);
        treeCount++;
        this._static(this._cylinder, this._material('#987d62'), x, y + 0.8, z, 0.16, 1.6, 0.16);
        this._static(this._cone, this._material(i % 2 ? '#719b84' : '#89ad87'), x, y + 2.8, z, 1.4, 4.5, 1.4);
      }
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU, x = size / 2 + Math.cos(a) * 154, z = size / 2 + Math.sin(a) * 154;
        this._static(this._sphere, this._material(i % 2 ? '#a4bcb0' : '#b0c5bb'), x, 1, z, 35, 12 + i % 3 * 4, 28, null, false);
      }
      for (let i = 0; i < 10; i++) {
        const x = -30 + i * 20, z = i % 2 ? -32 : 138;
        this._static(this._sphere, this._material('#edf2e9', { unlit: true }), x, 22 + i % 3 * 3, z, 6, 1.3, 2.1, null, false);
      }
      this._worldInfo.landscape = { terrainVertices: positions.length / 3, riverSamples: samples.length, riverWidth: 7.1, treeCount };
      this._landscapeStep(0);
    }

    _landscapeStep(time) {
      if (!this._riverFlow) return;
      const phase = this.reducedMotion ? 0 : time * 0.008;
      for (let i = 0; i < 18; i++) {
        const at = (i / 18 + phase) % 1, p = this._riverCurve.getPoint(at), tangent = this._riverCurve.getTangent(at);
        this._dummy.position.set(p.x, -0.295, p.z);
        this._dummy.rotation.set(0, -Math.atan2(tangent.z, tangent.x), 0);
        this._dummy.scale.set(0.8, 0.008, 0.035);
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
      this._staticBox('#94c99b', 54, 0.075, 54, 12.0, 0.14, 12.0, false);
      this._staticBox('#e6d8b2', 54, 0.155, 54, 1.5, 0.04, 11.9, false);
      this._staticBox('#e6d8b2', 54, 0.157, 54, 11.9, 0.04, 1.5, false);
      this._sign('MAYHEM MEADOWS', 48.05, 1.0, 54, -Math.PI / 2, '#f3e5ad', '#40785f', 3.5, 0.6);
      for (let i = 0; i < 8; i++) {
        const x = 49 + i * 1.2;
        this._static(this._sphere, this._material(palette[i % palette.length]), x, 0.32, 59.55, 0.19, 0.19, 0.19, null, false);
      }
    }

    _physicalProps() {
      // The town map owns both physical shapes and their visual placement.
      // Decoration can change without introducing a second obstacle layout.
      const colors = {
        tree: ['#a88462', '#67af91'], lamp: ['#536d74', '#536d74', '#fcf1be'],
        bench: ['#cf9771'], fountain: ['#eee7d3', '#f3eddc', '#f3eddc'],
        garage: ['#b8a1e0', '#ffe0b1'], wash: ['#89d7d1'], planter: ['#b08d77'],
        bollard: ['#5c7781'], wayfinding: ['#687d74', '#f1ddae']
      };
      for (const object of this.game.staticObjects || []) {
        const x = object.x / UNIT, z = object.y / UNIT, elevation = object.elevation || 0;
        const yaw = -(object.angle || 0), cosine = Math.cos(yaw), sine = Math.sin(yaw);
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
          this._static(geometry, material, px, py, pz, sx, sy, sz, [0, yaw, 0]);
          if (geometry && this._propAimMeshes) {
            // Raycast the exact shared shape without adding another draw call;
            // its visible twin is baked into the static material batches.
            const aimMesh = new this.T.Mesh(geometry, material);
            aimMesh.position.set(px, py, pz); aimMesh.scale.set(sx, sy, sz); aimMesh.rotation.y = yaw;
            aimMesh.updateMatrixWorld(true); this._propAimMeshes.push(aimMesh);
          }
          const extentX = Math.abs(cosine) * half[0] + Math.abs(sine) * half[2];
          const extentZ = Math.abs(sine) * half[0] + Math.abs(cosine) * half[2];
          this._propVolumes.push({ minX: px - extentX, maxX: px + extentX, minY: py - half[1], maxY: py + half[1], minZ: pz - extentZ, maxZ: pz + extentZ });
        }
        if (object.kind === 'tree') this._tree(x, z, object.scale || 1.05, object.variety || 0, false, elevation);
        if (object.kind === 'fountain') {
          this._static(this._cylinder, this._material('#7dd9e6'), x, elevation + 0.63, z, 1.43, 0.07, 1.43, null, false);
          this._static(this._sphere, this._material('#a3e5eb'), x, elevation + 1.70, z, 0.18, 0.55, 0.18, null, false);
        }
        if (object.kind === 'garage') this._sign('SPRINKLE GARAGE', x, elevation + 1.26, z - 0.68, 0, '#fff1c8', '#775688', 1.75, 0.5);
        if (object.kind === 'wash') this._sign('COOL-DOWN CAR WASH', x, elevation + 2.62, z - 0.35, Math.PI, '#dcfff1', '#3c827d', 4.5, 0.48);
        if (object.kind === 'wayfinding') this._sign(object.label, x, elevation + 1.3, z - 0.045, Math.PI, '#f1ddae', '#425e5c', 0.94, 0.37);
        if (object.kind === 'planter') {
          this._static(this._sphere, this._material('#7da676'), x, elevation + 0.62, z, 0.48, 0.23, 0.26);
          for (const side of [-1, 1]) this._static(this._sphere, this._material('#e8b393'), x + side * 0.27, elevation + 0.76, z, 0.08, 0.09, 0.08, null, false);
        }
      }
    }

    _services() {
      this._serviceRing(45, 45, '#c9a5ff');
      const x = 81, z = 99;
      this._serviceRing(x, z, '#78eee2');
    }

    _serviceRing(x, z, color) {
      const ring = this._mesh(this._ringGeometry, this._material(color, { unlit: true }), this.scene, x, 0.065, z, 0.88, 0.88, 0.88, false);
      ring.rotation.x = -Math.PI / 2;
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
      const T = this.T, group = new T.Group();
      const kind = police ? 'compact' : entity.kind;
      const dimensions = root.MayhemCore.CAR_TYPES[kind] || root.MayhemCore.CAR_TYPES.compact;
      const length = dimensions.length / UNIT, width = dimensions.width / UNIT;
      const body = this._material(police ? '#eff1de' : entity.color);
      const glass = this._material('#527c91');
      const under = this._material('#485767'), tires = this._material('#354555');
      this._box(group, under, 0, 0.38, 0, length * 0.94, 0.30, width * 0.91);
      const shell = this._box(group, body, 0, 0.65, 0, length, 0.45, width);
      this._box(group, body, length * 0.33, 0.87, 0, length * 0.30, 0.12, width * 0.96);
      this._box(group, glass, -0.19, kind === 'van' ? 1.225 : 1.00, 0, length * (kind === 'van' ? 0.67 : 0.47), kind === 'van' ? 0.84 : 0.41, width * 0.78);
      this._box(group, body, -0.20, kind === 'van' ? 1.60 : 1.22, 0, length * (kind === 'van' ? 0.69 : 0.48), 0.11, width * 0.84);
      // Slim pillars split the windows, and two bumpers frame the chunky body.
      for (const side of [-1, 1]) {
        this._box(group, body, -0.19, kind === 'van' ? 1.225 : 1.02, side * width * 0.405, 0.08, kind === 'van' ? 0.84 : 0.46, 0.055, false);
        this._box(group, '#f2edce', length / 2 + 0.012, 0.73, side * width * 0.30, 0.06, 0.17, 0.24, false);
        this._box(group, '#eb8781', -length / 2 - 0.012, 0.72, side * width * 0.30, 0.06, 0.15, 0.23, false);
        this._box(group, under, 0.13, 0.87, side * width * 0.50, 0.16, 0.04, 0.018, false);
      }
      this._box(group, '#e9e4d3', length / 2 + 0.04, 0.44, 0, 0.12, 0.12, width * 0.91);
      this._box(group, '#e9e4d3', -length / 2 - 0.04, 0.44, 0, 0.12, 0.12, width * 0.91);
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
      const paint = this._mergeColored(group, [shell, red, blue], police ? null : body);
      // Physics rotates about the chassis centre. Keep the original visual
      // coordinates inside a child, so a roll never orbits the model's feet.
      const centerHeight = (entity.colliderHeight || (kind === 'van' ? 1.7 : 1.3)) / 2;
      const pivot = new T.Group();
      group.position.y = 0.04 - centerHeight; pivot.add(group);
      this.scene.add(pivot);
      return { group: pivot, visual: group, centerHeight, wheels, shell, body, paint, color: entity.color, red, blue, police, roll: 0 };
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
        for (let i = range.start; i < range.start + range.count; i++) colors.setXYZ(i, value.r, value.g, value.b);
      }
      colors.needsUpdate = true;
    }

    _bubble() {
      const T = this.T, canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 128;
      const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
      this._textures.push(texture);
      const material = new T.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false });
      this._materials.set('bubble-' + this._textures.length, material);
      const sprite = new T.Sprite(material);
      sprite.position.set(0, 2.27, 0); sprite.scale.set(3.2, 0.80, 1); sprite.visible = false;
      return { canvas, texture, sprite, text: '' };
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

    _aimWorldPoint(pointerX, pointerY, width = this.width, height = this.height) {
      this._pointer.set(pointerX / Math.max(1, width) * 2 - 1, 1 - pointerY / Math.max(1, height) * 2);
      this._ray.setFromCamera(this._pointer, this.camera);
      let nearest = Infinity;
      const saveHit = point => {
        const distance = point.distanceToSquared(this._ray.ray.origin);
        if (distance < nearest) { nearest = distance; this._aimPoint.copy(point); }
      };
      // Buildings use the same collision envelope as the camera. People and
      // vehicles use their rendered meshes, so shoulder offset can converge on
      // the crosshair's subject rather than merely firing parallel to the view.
      for (const box of this._buildingVolumes) {
        this._aimBox.min.set(box.minX, box.minY, box.minZ);
        this._aimBox.max.set(box.maxX, box.maxY, box.maxZ);
        if (this._ray.ray.intersectBox(this._aimBox, this._aimHit)) saveHit(this._aimHit);
      }
      const subjects = [...(this._propAimMeshes || [])];
      for (const model of this._residents?.values() || []) if (model.group.visible) subjects.push(model.group);
      for (const [id, model] of this._vehicles || []) if (model.group.visible && id !== this.game.player.vehicleId) subjects.push(model.group);
      for (const group of subjects) group.updateWorldMatrix(true, true);
      for (const hit of this._ray.intersectObjects(subjects, true)) if (hit.object.isMesh) { saveHit(hit.point); break; }
      if (this._ray.ray.intersectPlane(this._ground, this._aimHit)) saveHit(this._aimHit);
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
      const pants = model.player ? '#355267' : '#647386';
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
        this._ragdollBox(s.a, s.limbQuaternion, 0.33, 0.14, 0.22, '#f2efdf', 0.075, 0, 0);
      }
      point(s.a, 'head'); point(s.b, 'chest');
      s.headUp.copy(s.a).sub(s.b);
      s.headRight.set(0, 0, 1).applyQuaternion(s.torsoQuaternion);
      this._ragdollFrame(s.headUp, s.headRight, s.headQuaternion);
      const dummy = this._ragdollDummy;
      dummy.position.copy(s.a); dummy.quaternion.copy(s.headQuaternion); dummy.scale.set(0.235 * CHARACTER_SCALE, 0.26 * CHARACTER_SCALE, 0.23 * CHARACTER_SCALE); dummy.updateMatrix();
      this._ragdollHeads.setMatrixAt(this._ragdollHeadIndex, dummy.matrix);
      this._color.set(skin); this._ragdollHeads.setColorAt(this._ragdollHeadIndex++, this._color);
      const hat = model.player ? '#f1cf5d' : '#6f5b55';
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
      let nearest = 1;
      const dx = endX - x, dy = endY - y, dz = endZ - z, margin = 0.22;
      for (const box of this._buildingVolumes) {
        let near = 0, far = 1;
        const values = [[x, dx, box.minX - margin, box.maxX + margin], [y, dy, box.minY, box.maxY + margin], [z, dz, box.minZ - margin, box.maxZ + margin]];
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

    _insideBuilding(x, y, z) {
      return this._buildingVolumes.some(box => x > box.minX - 0.17 && x < box.maxX + 0.17 && z > box.minZ - 0.17 && z < box.maxZ + 0.17 && y < box.maxY + 0.17 && y > box.minY);
    }

    _cameraStep(dt) {
      const current = this.game.current, driving = Boolean(this.game.player.vehicleId);
      const fallen = !driving && this._bodyFor(this.game.player);
      let x = current.x / UNIT, z = current.y / UNIT;
      const elevation = Number.isFinite(current.elevation) ? current.elevation : 0;
      // A roof landing needs the pivot above the roof's near-plane envelope.
      let targetHeight = fallen ? Math.max(0.55, (fallen.joints.pelvis.y + fallen.joints.chest.y) / 2 + 0.15) : elevation + (driving ? 1.15 : FOOT_PIVOT);
      if (fallen) {
        // A physical pelvis is smaller than the camera clearance envelope.
        // Move the look-at pivot out of that envelope before solving the boom,
        // including bodies resting on roofs, to avoid a zero-length camera.
        const margin = 0.27;
        for (const box of this._buildingVolumes) {
          if (x <= box.minX - margin || x >= box.maxX + margin || z <= box.minZ - margin || z >= box.maxZ + margin || targetHeight >= box.maxY + margin) continue;
          const exits = [
            { distance: x - box.minX + margin, x: box.minX - margin },
            { distance: box.maxX + margin - x, x: box.maxX + margin },
            { distance: z - box.minZ + margin, z: box.minZ - margin },
            { distance: box.maxZ + margin - z, z: box.maxZ + margin },
            { distance: box.maxY + margin - targetHeight, y: box.maxY + margin }
          ];
          let exit = exits[0];
          for (let i = 1; i < exits.length; i++) if (exits[i].distance < exit.distance) exit = exits[i];
          x = exit.x ?? x; z = exit.z ?? z; targetHeight = exit.y ?? targetHeight;
        }
      }
      const mode = driving ? 'drive' : 'foot';
      if (this._lastVehicleId !== this.game.player.vehicleId) {
        if (driving) this._driveOffset = angle(this._yaw - current.angle);
        else this._requestedYaw = this._yaw;
        this._lastVehicleId = this.game.player.vehicleId;
        this._orbitTimer = 0.45;
      }
      this._orbitTimer = Math.max(0, this._orbitTimer - dt);
      if (driving && this._orbitTimer === 0) {
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
      const distance = driving ? 7.4 + Math.min(1.8, speed * 0.06) : mix(5.5, 2.9, this._aimBlend);
      const horizontal = Math.cos(this._viewPitch) * distance;
      const shoulder = driving ? 0 : 0.70 * this._aimBlend;
      const clearance = driving ? 1.5 : mix(1.05, 0.50, this._aimBlend);
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
      const snap = !this._hasCamera || Math.hypot(this.camera.position.x - x, this.camera.position.z - z) > 18;
      if (snap) this.camera.position.copy(this._desiredCamera);
      else this.camera.position.lerp(this._desiredCamera, 1 - Math.exp(-dt * (obstructed ? 18 : 9)));
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
      this.camera.position.y = Math.max(0.45, this.camera.position.y);
      // Looking is independent of the physical boom pivot. Locking lookAt to
      // the character makes the centre crosshair point at the player's back.
      // The view instead faces ahead, including when walls shorten the boom.
      this._viewDirection.set(Math.cos(this._yaw) * Math.cos(this._viewPitch), Math.sin(this._viewPitch), Math.sin(this._yaw) * Math.cos(this._viewPitch));
      this._lookTarget.copy(this.camera.position).add(this._viewDirection);
      this.camera.lookAt(this._lookTarget);
      const fov = mix(57, 48, this._aimBlend);
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
      this._sun.position.set(shadowX - 22, 48, shadowZ - 30);
      this._sun.target.position.set(shadowX, 0, shadowZ);
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
      const stride = !this.reducedMotion && movement > 0.002 ? Math.sin(this._walkPhase) * 0.65 : 0;
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
      for (const ped of game.peds) {
        const resident = this._residents.get(ped.id);
        if (!resident) continue;
        const body = this._bodyFor(ped);
        resident.group.visible = !body;
        resident.group.position.set(ped.x / UNIT, (Number.isFinite(ped.elevation) ? ped.elevation : 0) + 0.03, ped.y / UNIT);
        resident.group.rotation.y = -ped.angle;
        const walk = !this.reducedMotion && ped.stunned <= 0 ? Math.sin(game.time * ped.pace / UNIT * 5 + Number(ped.id.split('-')[1])) * 0.30 : 0;
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
        this._bubbleText(resident.bubble, ped.bubbleTimer > 0 ? ped.bubble : '');
      }
      this._ragdollPeople();
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
        for (const wheel of model.wheels) wheel.rotation.z = model.roll;
        if (model.police) {
          const flashing = this.game.heat > 0 && !this.reducedMotion;
          const redOn = !flashing || Math.sin(this.game.time * 13) > 0;
          model.red.scale.y = redOn ? 0.13 : 0.075;
          model.blue.scale.y = redOn ? 0.075 : 0.13;
        } else {
          this._paintVehicle(model, entity.color);
          const broken = entity.health <= 0;
          if (!fullOrientation) model.group.rotation.z = broken ? 0.055 : 0;
          model.shell.material = broken ? this._material('#8f9aa1') : model.body;
        }
      }
      for (const [id, model] of this._vehicles) if (!active.has(id)) model.group.visible = false;
    }

    _projectileEffects() {
      if (!this._toyShots) {
        this._toyShots = new this.T.InstancedMesh(this._sphere, this._material('#ffffff', { unlit: true }), 32);
        this._toyShots.instanceMatrix.setUsage(this.T.DynamicDrawUsage);
        this._toyShots.frustumCulled = false;
        this.scene.add(this._toyShots);
      }
      const shots = this.game.projectiles || [];
      let count = 0;
      for (const shot of shots) {
        if (count === 32) break;
        if (shot.life <= 0 || !Number.isFinite(shot.x + shot.y + shot.height + shot.angle)) continue;
        this._dummy.position.set(shot.x / UNIT, shot.height, shot.y / UNIT);
        this._dummy.rotation.set(this.game.time * 8, -shot.angle, this.game.time * 5);
        this._dummy.scale.set(0.19, 0.19, 0.19);
        this._dummy.updateMatrix();
        this._toyShots.setMatrixAt(count, this._dummy.matrix);
        let hue = 0;
        for (const letter of String(shot.id)) hue = (hue + letter.charCodeAt(0)) % palette.length;
        this._color.set(palette[hue]); this._toyShots.setColorAt(count, this._color);
        count++;
      }
      this._toyShots.count = count;
      this._toyShots.visible = count > 0;
      this._toyShots.instanceMatrix.needsUpdate = true;
      if (this._toyShots.instanceColor) this._toyShots.instanceColor.needsUpdate = true;
    }

    _effects() {
      const game = this.game;
      this._projectileEffects();
      this._confetti.count = Math.min(360, game.particles.length);
      for (let i = 0; i < this._confetti.count; i++) {
        const particle = game.particles[i], age = particle.maxLife - particle.life;
        const rise = Math.sin(clamp(age / particle.maxLife, 0, 1) * Math.PI) * 1.75;
        this._dummy.position.set(particle.x / UNIT, (Number.isFinite(particle.height) ? Math.max(0, particle.height) : 0.20) + rise, particle.y / UNIT);
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
        this._dummy.position.set(mark.x / UNIT, 0.056, mark.y / UNIT);
        this._dummy.rotation.set(0, -mark.angle, 0);
        this._dummy.scale.set(0.55, 0.008, 0.85);
        this._dummy.updateMatrix(); this._skids.setMatrixAt(i, this._dummy.matrix);
      }
      this._skids.instanceMatrix.needsUpdate = true;
      const mission = game.mission, target = mission && mission.targets[mission.targetIndex];
      this._target.visible = Boolean(target);
      if (target) {
        this._target.position.set(target.x / UNIT, 0, target.y / UNIT);
        const pulse = this.reducedMotion ? 1 : 1 + Math.sin(game.time * 3) * 0.045;
        this._targetRing.scale.set(pulse, pulse, pulse);
        this._targetDiamond.rotation.y = this.reducedMotion ? 0 : game.time;
        this._targetDiamond.position.y = 3.4 + (this.reducedMotion ? 0 : Math.sin(game.time * 2.8) * 0.15);
      }
    }

    update(dt, options = {}) {
      const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
      if (options.reducedMotion !== undefined) this.reducedMotion = Boolean(options.reducedMotion);
      this._people(step);
      this._cars(options.paused ? 0 : step);
      this._effects();
      this._landscapeStep(this.game.time);
      this._cameraStep(step);
      this.renderer.render(this.scene, this.camera);
    }

    dispose() {
      this._ragdollCubes?.dispose();
      this._ragdollHeads?.dispose();
      this._toyShots?.dispose();
      this._riverFlow?.dispose();
      for (const geometry of this._geometries) geometry.dispose();
      for (const material of this._materials.values()) material.dispose();
      for (const texture of this._textures) texture.dispose();
      this.renderer.dispose();
    }
  }

  root.MayhemScene = Scene3D;
})(globalThis);
