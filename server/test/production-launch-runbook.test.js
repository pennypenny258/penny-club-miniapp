'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const doc=fs.readFileSync(path.join(__dirname,'..','..','docs','production-launch-runbook.md'),'utf8');

test('production runbook states current boundary and strict migration order',()=>{
  for(const text of ['当前处于哪一步','001、CloudBase 002、003、040','正式写入','004 → 140 → 190','005 → 250 → 260 → 290','006 → 340 → 390','007 → 440 → 490','008 → 540 → 590','009 → 640 → 690','011 → 740 → 790'])assert.equal(doc.includes(text),true,text);
  assert.ok(doc.indexOf('004 → 140 → 190')<doc.indexOf('011 → 740 → 790'));
});

test('production runbook keeps secrets server-only and cloud actions user-owned',()=>{
  for(const text of ['用户在 CloudBase 操作','用户在微信公众平台操作','不要开启数据库外网 IPv4','浏览器和小程序绝不能获得','需要用户再次明确批准','不让规则或模型自动发布需求'])assert.equal(doc.includes(text),true,text);
});
