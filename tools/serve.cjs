'use strict';
// Optional development server. The game itself also works from a file open.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 4173;
const allowed = new Set(['/index.html', '/styles.css', '/height-data.js', '/terrain.js', '/world.js', '/core.js', '/physics.js', '/vehicle-stats.js', '/vehicle-physics.js', '/audio.js', '/game.js', '/scene3d.js', '/vendor/three.min.js', '/vendor/cannon.min.js']);
allowed.add('/railway.js');allowed.add('/railway-render.js');
allowed.add('/assets/audio/samples.js');
allowed.add('/aircraft.js');
allowed.add('/aircraft-models.js');
allowed.add('/aliens.js');
allowed.add('/aliens-render.js');
allowed.add('/assets/audio/manifest.json');
for (const sample of require('../assets/audio/manifest.json').samples) {
  if (/^[a-z0-9-]+\.mp3$/.test(sample.file)) allowed.add('/assets/audio/' + sample.file);
}
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (_) { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname === '/') pathname = '/index.html';
  if (!allowed.has(pathname)) { res.writeHead(404); res.end('Not found'); return; }
  const file = path.join(root, pathname);
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Mayhem Meadows: http://127.0.0.1:${port}`));
