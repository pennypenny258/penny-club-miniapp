'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const doc=fs.readFileSync(path.join(__dirname,'..','..','docs','production-launch-runbook.md'),'utf8');

test('production runbook records the verified production intake baseline',()=>{
  for(const text of ['penny-club-prod-d6fcqtv83346494d','penny-club-prod-api','api.pennysclub.com','014_production_intake_008_baseline','87679197874494','ahFAKdsj','wx220dbae7ecd50002'])assert.equal(doc.includes(text),true,text);
});

test('production runbook requires canary validation before full traffic and real data',()=>{
  const required=['pennys_canary=prod-intake-final','一行合成 CSV','受控回滚','切换到 100%','首批只允许 1–3 条','private_review_pending'];
  for(const text of required)assert.equal(doc.includes(text),true,text);
  assert.ok(doc.indexOf('一行合成 CSV')<doc.indexOf('切换到 100%'));
});

test('production runbook keeps identity, secrets and protected data server-side',()=>{
  for(const text of ['前端不能自报角色','不使用 `*`','不开放数据库公网','不得进入 Git、聊天、截图、浏览器前端或小程序包','不会自动生成公开名册','私密链接加密'])assert.equal(doc.includes(text),true,text);
});

test('production runbook defines fail-closed incident and maintenance controls',()=>{
  for(const text of ['memoryFallback=true','停止新写入','不要删除历史审计记录','2026-12-09 20:59:59','90 天周期','回退演示内存'])assert.equal(doc.includes(text),true,text);
});
