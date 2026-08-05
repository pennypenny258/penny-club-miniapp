'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('direct local development keeps its existing default', () => {
  assert.deepEqual(validateDeploymentEnvironment({}), {
    profile:'local_development',
    anonymousDemoOnly:false
  });
});

test('CloudBase image defaults to safe anonymous staging without console variables', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /NODE_ENV=staging/);
  assert.match(dockerfile, /DEPLOYMENT_PROFILE=cloudbase_staging_demo/);
  assert.match(dockerfile, /DEMO_DATA_ONLY=true/);
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
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    DATA_REPOSITORY: 'postgres'
  }), /DATA_REPOSITORY/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    CLOUDBASE_PG_SERVER_API_KEY: 'fixture-only'
  }), /CLOUDBASE_PG_SERVER_API_KEY/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    MEMBER_IDENTITY_PROVIDER: 'external_verified_session'
  }), /MEMBER_IDENTITY_PROVIDER/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    PRIVATE_STORAGE_PROVIDER: 'cloudbase_pg_storage'
  }), /PRIVATE_STORAGE_PROVIDER/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    OBJECT_LOCATOR_ENCRYPTION_KEY: 'fixture-only'
  }), /OBJECT_LOCATOR_ENCRYPTION_KEY/);
  assert.equal(validateDeploymentEnvironment({DEPLOYMENT_PROFILE:'cloudbase_staging_demo',DEMO_DATA_ONLY:'true',DATA_REPOSITORY:'memory_demo'}).anonymousDemoOnly,true);
});
