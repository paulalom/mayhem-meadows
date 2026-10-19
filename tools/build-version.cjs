'use strict';

const versionMarker = '<span id="game-version" class="game-version">LOCAL BUILD</span>';

function createBuildInfo(baseVersion, env = process.env) {
  const parts = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(baseVersion);
  if (!parts || parts.slice(1).some(value => !Number.isSafeInteger(Number(value)))) {
    throw new Error('Package version must contain three non-negative integers.');
  }
  if (env.DEPLOY_NUMBER === undefined && env.DEPLOY_SHA === undefined && env.DEPLOY_ATTEMPT === undefined) {
    return { version: `${baseVersion}-dev`, baseVersion, deployment: null, commit: null, attempt: null };
  }
  const deployment = Number(env.DEPLOY_NUMBER), attempt = Number(env.DEPLOY_ATTEMPT ?? '1');
  if (!/^[1-9]\d*$/.test(env.DEPLOY_NUMBER || '') || !Number.isSafeInteger(deployment)
      || !/^[1-9]\d*$/.test(env.DEPLOY_ATTEMPT ?? '1') || !Number.isSafeInteger(attempt)
      || !/^[a-f0-9]{40}$/i.test(env.DEPLOY_SHA || '')) {
    throw new Error('Deployment requires a positive DEPLOY_NUMBER, DEPLOY_ATTEMPT and a full DEPLOY_SHA.');
  }
  const patch = Number(parts[3]) + deployment;
  if (!Number.isSafeInteger(patch)) throw new Error('Deployment version exceeds the supported range.');
  return { version: `${parts[1]}.${parts[2]}.${patch}`, baseVersion, deployment, commit: env.DEPLOY_SHA.toLowerCase(), attempt };
}

function stampVersion(html, info) {
  if (html.split(versionMarker).length !== 2) throw new Error('Expected exactly one game version label.');
  const detail = info.commit ? `Deployment ${info.deployment} · commit ${info.commit.slice(0, 7)} · attempt ${info.attempt}` : 'Local development build';
  return html.replace(versionMarker, `<span id="game-version" class="game-version" title="${detail}" aria-label="Game version ${info.version}">v${info.version}</span>`);
}

module.exports = { createBuildInfo, stampVersion };
