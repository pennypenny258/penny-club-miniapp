'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {handleProductionBootstrap}=require('../src/production-bootstrap');
const {validateDeploymentEnvironment}=require('../src/deployment');
const {resolvePersistenceConfig}=require('../src/persistence/config');
const {createRepository}=require('../src/persistence/repository');
const {resolveCrmPersistentImportConfig}=require('../src/persistence/crm-import-pipeline');

const deployment={profile:'cloudbase_production_bootstrap',anonymousDemoOnly:false,bootstrapOnly:true,businessApisEnabled:false};
const config=resolvePersistenceConfig({NODE_ENV:'production',DEPLOYMENT_PROFILE:'cloudbase_production_bootstrap',DEMO_DATA_ONLY:'false',DATA_REPOSITORY:'production_bootstrap_disabled'});
const repository=createRepository({config,store:{sensitiveFixture:'must-never-return'}});
function response(){return {status:null,headers:null,body:'',writeHead(status,headers){this.status=status;this.headers=headers},end(value=''){this.body+=value}}}
function request(url,method='GET'){return {url,method}}

test('production bootstrap health is healthy but explicitly not configured',()=>{
  const res=response();
  assert.equal(handleProductionBootstrap(request('/healthz'),res,{deployment,repository}),true);
  assert.equal(res.status,200);
  const body=JSON.parse(res.body);
  assert.equal(body.ok,true);assert.equal(body.anonymousDemoOnly,false);assert.equal(body.businessApisEnabled,false);
  assert.equal(body.serviceState,'production_bootstrap_not_configured');assert.equal(body.persistence.persistent,false);
  assert.equal(res.body.includes('must-never-return'),false);
});

test('production bootstrap blocks member admin and business APIs before static/demo handlers',()=>{
  for(const url of ['/admin/','/member/','/api/me','/api/admin/crm-members']){
    const res=response();handleProductionBootstrap(request(url),res,{deployment,repository});
    assert.equal(res.status,503,url);const body=JSON.parse(res.body);
    assert.equal(body.code,'PRODUCTION_BOOTSTRAP_NOT_CONFIGURED');assert.equal(body.anonymousDemoOnly,false);
    assert.equal(res.body.includes('must-never-return'),false);
  }
});

test('production bootstrap root explains the locked state without demo content',()=>{
  const res=response();handleProductionBootstrap(request('/'),res,{deployment,repository});
  assert.equal(res.status,200);assert.match(res.body,/生产初始化服务已启动/);assert.match(res.body,/匿名演示数据均未开放/);
});

test('bootstrap handler is inert outside the dedicated deployment profile',()=>{
  const res=response();assert.equal(handleProductionBootstrap(request('/member/'),res,{deployment:{bootstrapOnly:false},repository}),false);assert.equal(res.status,null);
});

test('the complete documented bootstrap environment accepts explicit false feature flags',()=>{
  const environment={NODE_ENV:'production',DEPLOYMENT_PROFILE:'cloudbase_production_bootstrap',DEMO_DATA_ONLY:'false',DATA_REPOSITORY:'production_bootstrap_disabled',PORT:'3000',WECHAT_LOGIN_ENABLED:'false',FORMAL_ADMIN_AUTH_ENABLED:'false',FORMAL_AGENT_ROUTES_ENABLED:'false',FORMAL_MEMBER_BINDING_ROUTES_ENABLED:'false',ADMIN_GOVERNANCE_ENABLED:'false',CLOUDBASE_CATALOG_READS_ENABLED:'false',CLOUDBASE_STORAGE_ENABLED:'false',GOVERNED_MEMBER_IMPORTS_ENABLED:'false',GOVERNED_MATERIALIZATION_ENABLED:'false'};
  assert.equal(validateDeploymentEnvironment(environment).bootstrapOnly,true);
  assert.equal(resolvePersistenceConfig(environment).mode,'production_bootstrap_disabled');
  assert.equal(resolveCrmPersistentImportConfig(environment).enabled,false);
});
