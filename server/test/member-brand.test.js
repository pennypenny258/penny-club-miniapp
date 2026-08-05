'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..','..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('browser member shell exposes the exact restrained brand copy',()=>{
  const html=read('server/public/member.html');
  assert.equal((html.match(/Penny’s Club/g)||[]).length,1);
  assert.equal((html.match(/佩妮创投会员服务/g)||[]).length,1);
  assert.match(html,/member-brand\.css/);
});

test('all four mini-program member tabs use the shared brand component',()=>{
  const pages=['home','resources','demands','profile'];
  for(const page of pages)assert.match(read(`miniprogram/pages/${page}/${page}.wxml`),/<member-brand\s*\/>/,page);
  const component=read('miniprogram/components/member-brand/member-brand.wxml');
  assert.equal((component.match(/Penny’s Club/g)||[]).length,1);
  assert.equal((component.match(/佩妮创投会员服务/g)||[]).length,1);
  assert.match(read('miniprogram/app.json'),/"member-brand":"\/components\/member-brand\/member-brand"/);
});
