# Locally bundled 3D engine

`three.min.js` is an IIFE bundle of Three.js **0.180.0**, built with esbuild **0.25.9**. It exposes the classic `THREE` global. The game makes no requests to a CDN or package registry at runtime, and its static files also work from a file open.

Source: https://github.com/mrdoob/three.js/tree/r180

License: MIT; see `THREE-LICENSE.txt`.

Rebuild with `npm ci` followed by `npm run vendor`. Package versions are pinned in `package-lock.json`.
