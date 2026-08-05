'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..','..');
test('admin, browser member and mini program expose two independent categories',()=>{
  const files=['server/public/app.js','server/public/member.js','miniprogram/pages/resources/resources.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8'));
  for(const content of files){assert.match(content,/research_reports/);assert.match(content,/group_digests/);assert.match(content,/研究报告/);assert.match(content,/群聊精华/)}
  assert.doesNotMatch(files[1],/报告与群聊精华/);assert.doesNotMatch(files[2],/报告与群聊精华/);
});
