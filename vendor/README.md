# Locally bundled 3D engine

`three.min.js` is an IIFE bundle of Three.js **0.180.0**, built with esbuild **0.25.9**. It exposes the classic `THREE` global. The game makes no requests to a CDN or package registry at runtime, and its static files also work from a file open.

Source: https://github.com/mrdoob/three.js/tree/r180

License: MIT; see `THREE-LICENSE.txt`.

Rebuild with `npm ci` followed by `npm run vendor`. Package versions are pinned in `package-lock.json`.

`cannon.min.js` bundles cannon-es **0.20.0** into the classic `CANNON` global for vehicle rigid-body physics. `cannon.cjs` is the same pinned engine for Node simulation checks. Both bundles are local; no network connection is needed to play.

Source: https://github.com/pmndrs/cannon-es/tree/v0.20.0

License: MIT; see `cannon-LICENSE.txt`.
