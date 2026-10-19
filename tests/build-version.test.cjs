'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBuildInfo, stampVersion } = require('../tools/build-version.cjs');
const commit = 'abcdef0' + '1'.repeat(33);
const deployment = (number, extra = {}) => ({ DEPLOY_NUMBER: String(number), DEPLOY_SHA: commit, ...extra });

test('local builds identify themselves without consuming a deployment number', () => {
  assert.deepEqual(createBuildInfo('0.9.0', {}), {
    version: '0.9.0-dev', baseVersion: '0.9.0', deployment: null, commit: null, attempt: null
  });
});

test('publishing runs increase the patch version and preserve the package release series', () => {
  assert.equal(createBuildInfo('0.9.0', deployment(12)).version, '0.9.12');
  assert.equal(createBuildInfo('0.9.0', deployment(13)).version, '0.9.13');
  assert.equal(createBuildInfo('0.10.2', deployment(14)).version, '0.10.16');
});

test('a rerun keeps its version while recording the new attempt and exact commit', () => {
  const first = createBuildInfo('0.9.0', deployment(12));
  const retry = createBuildInfo('0.9.0', deployment(12, { DEPLOY_ATTEMPT: '2', DEPLOY_SHA: commit.toUpperCase() }));
  assert.equal(first.version, retry.version);
  assert.equal(retry.attempt, 2);
  assert.equal(retry.commit, commit);
});

test('incomplete, malformed or unsafe publishing metadata fails instead of creating a release', () => {
  for (const env of [
    { DEPLOY_SHA: commit }, { DEPLOY_NUMBER: '12' },
    ...['0', '-1', '1.5', '1e2', '9007199254740992'].map(number => deployment(number)),
    deployment(12, { DEPLOY_ATTEMPT: '0' }), deployment(12, { DEPLOY_SHA: '<script>' }),
    deployment(12, { DEPLOY_SHA: 'abcdef0' })
  ]) assert.throws(() => createBuildInfo('0.9.0', env), /Deployment requires/);
  assert.throws(() => createBuildInfo('0.9.9007199254740991', deployment(1)), /supported range/);
  assert.throws(() => createBuildInfo('0.9', {}), /Package version/);
});

test('the real game page contains a static, accessible version label inside its fullscreen container', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const html = stampVersion(source, createBuildInfo('0.9.0', deployment(12)));
  assert.match(html, /id="game-version"[^>]*aria-label="Game version 0\.9\.12">v0\.9\.12<\/span>/);
  assert.match(html, /title="Deployment 12 · commit abcdef0 · attempt 1"/);
  assert.match(html, /href="styles\.css\?v=0\.9\.12"/);
  assert.match(html, /src="game\.js\?v=0\.9\.12"/);
  assert.ok(html.indexOf('id="game-version"') > html.indexOf('id="game-shell"'));
  assert.ok(html.indexOf('id="game-version"') < html.indexOf('id="start-screen"'));
  assert.doesNotMatch(html, /LOCAL BUILD/);
  assert.match(stampVersion(source, createBuildInfo('0.9.0', {})), />v0\.9\.0-dev<\/span>/);
});

test('missing or duplicate labels prevent a build from silently publishing an unstamped page', () => {
  const marker = '<span id="game-version" class="game-version">LOCAL BUILD</span>';
  const info = createBuildInfo('0.9.0', {});
  assert.throws(() => stampVersion('<html></html>', info), /exactly one/);
  assert.throws(() => stampVersion(marker + marker, info), /exactly one/);
});
