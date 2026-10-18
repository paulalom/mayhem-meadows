'use strict';

// Prepare only the files needed to play on a static host. No bundler is required.
const fs = require('node:fs');
const path = require('node:path');

const project = path.resolve(__dirname, '..');
const output = path.resolve(project, 'dist');
const runtimeFiles = [
  'index.html',
  'styles.css',
  'height-data.js',
  'railway.js',
  'railway-render.js',
  'terrain.js',
  'world.js',
  'physics.js',
  'vehicle-stats.js',
  'vehicle-physics.js',
  'aircraft.js',
  'aircraft-models.js',
  'aliens.js',
  'aliens-render.js',
  'core.js',
  'scene3d.js',
  'audio.js',
  'game.js',
  'vendor/three.min.js',
  'vendor/cannon.min.js',
  'assets/audio/samples.js',
  'LICENSE',
  'vendor/THREE-LICENSE.txt',
  'vendor/cannon-LICENSE.txt',
];

function readSource(relativePath) {
  const parts = relativePath.split('/');
  let source = project;
  for (let i = 0; i < parts.length; i++) {
    source = path.join(source, parts[i]);
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) throw new Error(`Refusing linked source: ${relativePath}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Source directory is missing: ${relativePath}`);
    if (i === parts.length - 1 && !stat.isFile()) throw new Error(`Source is not a regular file: ${relativePath}`);
  }
  return { relativePath, data: fs.readFileSync(source) };
}

function build() {
  // Read every source before touching the previous build, so a missing asset
  // leaves the last output available. Reject links in source directories too.
  const files = runtimeFiles.map(readSource);
  files.push({ relativePath: '.nojekyll', data: Buffer.alloc(0) });

  // Keep recursive removal pinned to this project's direct dist directory.
  if (path.dirname(output) !== project || path.basename(output) !== 'dist' || output === project) {
    throw new Error(`Unsafe output directory: ${output}`);
  }
  let existing;
  try { existing = fs.lstatSync(output); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new Error(`Output must be an ordinary directory: ${output}`);
  }
  if (existing) fs.rmSync(output, { recursive: true });
  fs.mkdirSync(output, { recursive: true });

  let bytes = 0;
  for (const { relativePath, data } of files) {
    const destination = path.join(output, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
    bytes += data.length;
  }
  process.stdout.write(`Built ${files.length} files (${(bytes / 1024 / 1024).toFixed(2)} MiB) in ${output}\n`);
}

try { build(); }
catch (error) {
  process.stderr.write(`Site build failed: ${error.message}\n`);
  process.exitCode = 1;
}
