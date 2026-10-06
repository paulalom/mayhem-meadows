The user supplied both images as layout and terrain references.

- reference-city-map.png: city layout, 1536 × 1024, 8-bit RGB.
- reference-heightmap.png: grayscale terrain stored as 1536 × 1024, 8-bit RGB.

height-data.js contains a 385 × 257 numeric import of the grayscale image and its SHA-256 source hash. Terrain spans a 600 × 400 metre reference region, with ocean padding to fit the square game boundary. Bright pixels become hills; dark water regions become a river or sea bed. terrain.js grades streets and levels building foundations while retaining the broad shape of the source. The runtime preserves the input's 8-bit precision; it does not claim 16-bit source data or the printed mountain elevations.

The images remain unchanged and are not required for runtime loading. All numeric data and engines are bundled locally for offline play.
