# Aircraft artwork

These seven original low-poly airframes were authored in Blender for Mayhem Meadows.
They use solid colours, silhouettes readable from the chase camera, separate moving
parts, and the same metres as the rest of the 3D scene. No external assets, paid
generators, textures, or runtime model downloads are required.

- `aircraft-workshop.blend` is the editable source scene, with all seven aircraft
  laid out together under named parent objects.
- `fleet-preview.png` shows the complete fleet rendered from that source.
- `manifest.json` records names, dimensions, and triangle counts.
- `../../aircraft-models.js` is the browser-ready geometry, about 181 KB total.

The fleet includes the Meadowlark high-wing trainer, Cloudliner twin turboprop,
Firefly civilian helicopter, Channel Six news helicopter, Patrol police helicopter,
Atlas transport helicopter, and Kestrel interceptor. The news helicopter has a
camera gimbal and aerials. The police variant carries a searchlight, beacons, and
a side-mounted impact-round cannon with a bright orange safety collar.

To rebuild, open Blender and execute `tools/export-aircraft.py` through its Python
console with `exec(compile(open(path).read(), path, 'exec'), {'__file__': path})`,
where `path` is the absolute path to that script. It creates a dedicated **Mayhem
Aircraft Workshop** scene, exports the JavaScript and manifest, renders the preview,
and saves a copy of the source. It preserves other scenes and replaces only its own
workshop on subsequent runs.

The JavaScript exposes `MayhemAircraftModels` with keys `trainer`, `commuter`,
`helicopter`, `news`, `policeheli`, `transportheli`, and `fighter`. Coordinates use
**+X forward, +Y up, +Z starboard**. Each part stores indexed triangle positions,
its colour, and its local pivot. Animation tags are `propeller` (X axis), `mainRotor`
(Y axis), and `tailRotor` (Z axis). Geometry remains relative to its pivot.
The seven airframes contain 8,148 triangles altogether. Their artwork is covered
by this repository's MIT licence.
