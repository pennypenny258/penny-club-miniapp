'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePort, validateDeploymentEnvironment } = require('../src/deployment');

test('CloudBase port defaults to 3000 and accepts platform override', () => {
  assert.equal(parsePort(), 3000);
  assert.equal(parsePort('8080'), 8080);
  assert.throws(() => parsePort('abc'), /PORT/);
  assert.throws(() => parsePort('9100'), /9100/);
});

test('CloudBase staging profile requires anonymous demo mode', () => {
  assert.deepEqual(validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true'
  }), { profile:'cloudbase_staging_demo', anonymousDemoOnly:true });
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo'
  }), /DEMO_DATA_ONLY=true/);
});

test('CloudBase staging profile rejects local storage and real integrations', () => {
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    PRIVATE_STORAGE_DIR: './server/private-storage'
  }), /PRIVATE_STORAGE_DIR/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    FEISHU_APP_SECRET: 'fixture-only'
  }), /FEISHU_APP_SECRET/);
});
