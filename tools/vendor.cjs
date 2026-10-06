'use strict';
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const shared = { bundle: true, minify: true, legalComments: 'eof', absWorkingDir: root };
async function bundle() {
  await Promise.all([
    esbuild.build({ ...shared, entryPoints: ['./tools/three-entry.js'], format: 'iife', globalName: 'THREE', outfile: 'vendor/three.min.js' }),
    esbuild.build({ ...shared, entryPoints: ['./tools/cannon-entry.js'], format: 'iife', globalName: 'CANNON', outfile: 'vendor/cannon.min.js' }),
    esbuild.build({ ...shared, entryPoints: ['./tools/cannon-entry.js'], platform: 'node', format: 'cjs', outfile: 'vendor/cannon.cjs' })
  ]);
  fs.copyFileSync(path.join(root, 'node_modules/cannon-es/LICENSE'), path.join(root, 'vendor/cannon-LICENSE.txt'));
}
bundle().catch(error => { console.error(error); process.exitCode = 1; });
