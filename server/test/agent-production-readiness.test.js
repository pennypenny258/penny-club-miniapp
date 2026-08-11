'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PassThrough}=require('node:stream');
const server=require('../src/server');

function getReadiness(){return new Promise((resolve,reject)=>{const req=new PassThrough();req.method='GET';req.url='/api/admin/agent/readiness';req.headers={host:'localhost','x-demo-role':'administrator'};const response={statusCode:200,writeHead(status){this.statusCode=status},end(chunk=''){try{resolve({status:this.statusCode,body:JSON.parse(String(chunk||'{}'))})}catch(error){reject(error)}}};req.on('error',reject);server.emit('request',req,response);req.end()})}

test('admin readiness is explicit, safe and keeps formal Agent writes disabled',async()=>{
  const response=await getReadiness();assert.equal(response.status,200);
  assert.equal(response.body.status,'offline_preparation_only');assert.equal(response.body.cloudWrites,false);assert.equal(response.body.routesMounted,false);assert.equal(response.body.memoryFallback,false);
  assert.equal(response.body.directionalRule,'3_of_4');assert.equal(response.body.directionalDeduplicationDays,14);assert.equal(response.body.deliveryMode,'operator_relay_only');assert.equal(response.body.contactDisclosure,false);
  const serialized=JSON.stringify(response.body);for(const forbidden of ['serverApiKey','passwordValue','phoneNumber','rawOpenid','crmRow'])assert.equal(serialized.includes(forbidden),false);
});

test('Agent rehearsal UI shows the honest production boundary',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  for(const text of ['/api/admin/agent/readiness','正式持久化状态','至少匹配 3/4 维度','14 天内不重复提醒','仍由运营代转'])assert.equal(source.includes(text),true,text);
});
