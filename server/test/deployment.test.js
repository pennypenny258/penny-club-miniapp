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

test('CloudBase image defaults to locked production bootstrap without console variables', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', '..', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /NODE_ENV=production/);
  assert.match(dockerfile, /DEPLOYMENT_PROFILE=cloudbase_production_bootstrap/);
  assert.match(dockerfile, /DEMO_DATA_ONLY=false/);
  assert.match(dockerfile, /DATA_REPOSITORY=production_bootstrap_disabled/);
});

test('production bootstrap requires an explicit locked non-demo configuration',()=>{
  const environment={NODE_ENV:'production',DEPLOYMENT_PROFILE:'cloudbase_production_bootstrap',DEMO_DATA_ONLY:'false',DATA_REPOSITORY:'production_bootstrap_disabled'};
  assert.deepEqual(validateDeploymentEnvironment(environment),{profile:'cloudbase_production_bootstrap',anonymousDemoOnly:false,bootstrapOnly:true,businessApisEnabled:false});
  for(const key of ['NODE_ENV','DEMO_DATA_ONLY','DATA_REPOSITORY']){const invalid={...environment};delete invalid[key];assert.throws(()=>validateDeploymentEnvironment(invalid),new RegExp(key));}
  assert.throws(()=>validateDeploymentEnvironment({...environment,CLOUDBASE_PG_ENV_ID:'fixture-env'}),/CLOUDBASE_PG_ENV_ID/);
  assert.throws(()=>validateDeploymentEnvironment({...environment,WECHAT_LOGIN_ENABLED:'true'}),/WECHAT_LOGIN_ENABLED/);
  assert.throws(()=>validateDeploymentEnvironment({...environment,FORMAL_AGENT_ROUTES_ENABLED:'true'}),/FORMAL_AGENT_ROUTES_ENABLED/);
  assert.throws(()=>validateDeploymentEnvironment({...environment,CLOUDBASE_AGENT_RPC_ENABLED:'true'}),/CLOUDBASE_AGENT_RPC_ENABLED/);
  assert.throws(()=>validateDeploymentEnvironment({...environment,CLOUDBASE_AGENT_RPC_MANIFEST_SHA256:'a'.repeat(64)}),/CLOUDBASE_AGENT_RPC_MANIFEST_SHA256/);
  assert.throws(()=>validateDeploymentEnvironment({...environment,FORMAL_MEMBER_BINDING_ROUTES_ENABLED:'true'}),/FORMAL_MEMBER_BINDING_ROUTES_ENABLED/);
  assert.throws(()=>validateDeploymentEnvironment({...environment,CRM_MATCH_TOKEN_PROVISIONING_PREPARED:'true'}),/CRM_MATCH_TOKEN_PROVISIONING_PREPARED/);
  assert.throws(()=>validateDeploymentEnvironment({...environment,MEMBER_BINDING_MODE:'crm_exact_match_or_operator_review'}),/MEMBER_BINDING_MODE/);
  assert.throws(()=>validateDeploymentEnvironment({...environment,DATABASE_URL:'postgresql:\/\/fixture'}),/DATABASE_URL/);
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
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    GOVERNED_MEMBER_IMPORTS_ENABLED: 'true'
  }), /GOVERNED_MEMBER_IMPORTS_ENABLED/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',
    DEMO_DATA_ONLY: 'true',
    GOVERNED_IMPORT_ENCRYPTION_KEY: 'fixture-only'
  }), /GOVERNED_IMPORT_ENCRYPTION_KEY/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE: 'cloudbase_staging_demo',DEMO_DATA_ONLY: 'true',GOVERNED_MATERIALIZATION_ENABLED: 'true'
  }), /GOVERNED_MATERIALIZATION_ENABLED/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE:'cloudbase_staging_demo',DEMO_DATA_ONLY:'true',FORMAL_ADMIN_AUTH_ENABLED:'true'
  }), /FORMAL_ADMIN_AUTH_ENABLED/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE:'cloudbase_staging_demo',DEMO_DATA_ONLY:'true',ADMIN_SESSION_HASH_KEY:'fixture-only'
  }), /ADMIN_SESSION_HASH_KEY/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE:'cloudbase_staging_demo',DEMO_DATA_ONLY:'true',ADMIN_GOVERNANCE_ENABLED:'true'
  }), /ADMIN_GOVERNANCE_ENABLED/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE:'cloudbase_staging_demo',DEMO_DATA_ONLY:'true',CRM_MATCH_TOKEN_PROVISIONING_PREPARED:'true'
  }), /CRM_MATCH_TOKEN_PROVISIONING_PREPARED/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE:'cloudbase_staging_demo',DEMO_DATA_ONLY:'true',CLOUDBASE_AGENT_RPC_CAPABILITY_VERSION:'agent-mvp-rpc-v1'
  }), /CLOUDBASE_AGENT_RPC_CAPABILITY_VERSION/);
  assert.throws(() => validateDeploymentEnvironment({
    DEPLOYMENT_PROFILE:'cloudbase_staging_demo',DEMO_DATA_ONLY:'true',CLOUDBASE_AGENT_RPC_ENABLED:'true'
  }), /CLOUDBASE_AGENT_RPC_ENABLED/);
  assert.equal(validateDeploymentEnvironment({DEPLOYMENT_PROFILE:'cloudbase_staging_demo',DEMO_DATA_ONLY:'true',DATA_REPOSITORY:'memory_demo'}).anonymousDemoOnly,true);
});
