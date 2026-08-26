'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..','..');
test('admin retains resource categories while member clients expose activities only',()=>{
  const files=['server/public/app.js','server/public/member.js','miniprogram/pages/resources/resources.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8'));
  assert.match(files[0],/research_reports/);assert.match(files[0],/group_digests/);assert.match(files[0],/研究报告/);assert.match(files[0],/群聊精华/);
  for(const content of files.slice(1)){assert.doesNotMatch(content,/research_reports|group_digests/);assert.match(content,/\/api\/activities/);assert.match(content,/等待开启/);assert.match(content,/已完成/)}
});
